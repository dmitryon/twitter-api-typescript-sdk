# X Chat Implementation Notes & Pitfalls

> Living document of gotchas, undocumented behaviors, and lessons learned while implementing X Chat E2E encryption.

## Encryption Stack (Verified)

The official migration guide references the **chat-xdk** (Rust SDK with Python bindings) which implies X25519/Ed25519/AES-256-GCM from its API surface. However, the actual crypto primitives used by the server are different. The correct stack was reverse-engineered from the Go reference implementation at `mautrix-twitter` (`pkg/twittermeow/crypto/`).

| What the docs imply | What's actually used |
|---------------------|---------------------|
| X25519 key agreement | **P-256 ECDSA** (two separate keys) |
| Ed25519 signing | **ECDSA P-256 SHA-256** |
| AES-256-GCM message encryption | **XSalsa20-Poly1305 (libsodium secretbox)** |
| HKDF + AES-GCM key wrapping | **P-256 ECDH + KDF2-SHA256 + AES-128-GCM** |
| Flat MessageCreateEvent thrift | **Nested MessageEntryHolder wrapper** |

## Key Types

Each user has **two separate P-256 ECDSA keys** (not one):

- **Decrypt key** (aka `SecretKey` in Go, `public_key` in API) — used to unwrap conversation keys via ECDH
- **Signing key** (aka `SigningKey` in Go, `signing_public_key` in API) — used to sign outgoing messages

Both are stored as 32-byte raw private scalars in base64.

### Key Order in Juicebox Secret

The 64-byte secret recovered from Juicebox is:
```
bytes[0:32]  = decrypt key (private scalar)
bytes[32:64] = signing key (private scalar)
```

**Pitfall**: Getting these swapped means ECDH fails with "Public key is not valid for specified curve" when trying to unwrap conversation keys, and messages signed with the wrong key are silently rejected by the server.

## Juicebox (PIN-based Key Recovery)

### CRITICAL: Never Retry Wrong PINs

Each failed `unlockKeys` attempt with a wrong PIN **permanently decrements the guess counter** on Juicebox realms. Once exhausted (`max_guess_count: 20` in production config), the secret is permanently destroyed — the user loses access to their private keys and all encrypted conversations forever.

**Rules:**
- Never auto-retry `unlockKeys` on failure
- If recovery returns "Invalid PIN" or guess count decrements, stop immediately and surface the error to the user
- Never call `unlockKeys` in a loop or background job
- Store the PIN only after a successful unlock — do not persist an unverified PIN

### Auth Tokens Expire

The `juicebox_config.token_map` contains bearer tokens for authenticating to Juicebox realms. These tokens **expire** (short-lived). The `unlockKeys` flow must always fetch fresh public keys from the API — never use cached `juicebox_config` for recovery.

**Symptom**: All realms return HTTP 401.

### userInfo is Empty

The Go bridge passes **empty bytes** as `userInfo` to Juicebox `Recover()`:
```go
secret, err := client.Recover(ctx, []byte(pin), []byte(""))
```

**Pitfall**: Passing the user ID as `userInfo` (which seems logical) produces a different Argon2 hash and results in "Invalid PIN" with guess count decrement.

### Hash-to-Point: DeriveDalek, not RFC 9380

The OPRF uses `DeriveDalek` to hash input to a Ristretto255 point:
```
SHA-512(input) → 64 bytes → deriveToCurve (Elligator2 map)
```

This is **NOT** the same as `hashToCurve` (RFC 9380 hash-to-curve). Using the wrong hash-to-point produces a valid-looking but incorrect OPRF output, resulting in "Invalid PIN".

**In @noble/curves**: use `ristretto255_hasher.deriveToCurve(sha512(input))`, NOT `ristretto255_hasher.hashToCurve(input)`.

### HKDF in Noise Protocol

The Noise NK handshake uses standard **HKDF (RFC 5869)** with Blake2s as the hash function. This is NOT the same as keyed Blake2s:
```
HKDF-Blake2s(salt, ikm) ≠ blake2s(ikm, { key: salt })
```

**Pitfall**: Using keyed Blake2s instead of proper HKDF produces `SessionError` from hardware realms.

### Hardware Realm Session Management

- Hardware realms use Noise NK protocol (`Noise_NK_25519_ChaChaPoly_BLAKE2s`)
- The `session_id` must be consistent between handshake and subsequent transport requests
- `Recover2` and `Recover3` require **forward secrecy** — must be sent via Noise transport, not piggybacked on handshake
- Phase 1 (`Recover1`) can be piggybacked on the handshake payload

### CBOR Serialization Quirks

- `Recover1` is serialized as the **string** `"Recover1"`, not an object
- `Recover2`/`Recover3` are serialized as `{"Recover2": {...}}` (named map)
- Binary fields must use `Buffer` (not `Uint8Array`) with `cbor-x` to avoid typed array CBOR tags that realms don't understand
- Response field names are **capitalized**: `Recover1`, `Ok`, `NotRegistered` (Rust serde enum style)
- Hardware realm responses are padded: `{ unpadded_length, padded_bytes }` — extract inner CBOR from `padded_bytes[0:unpadded_length]`

## Conversation Key Wrapping

### Blob Format
```
ephemeralPublicKey (65 bytes, uncompressed P-256) || AES-GCM(ciphertext + tag)
```

Total: 113 bytes for a 32-byte conversation key (65 + 32 + 16).

### KDF
```
KDF2-SHA256(shared_secret, ephemeral_public_key) → 32 bytes
  first 16 bytes = AES-128 key
  last 16 bytes  = GCM IV/nonce
```

### Public Key Format

The X API returns public keys in **SPKI format** (91 bytes DER, base64). The raw uncompressed point (65 bytes) is at offset 26:
```
SPKI DER prefix (26 bytes) || uncompressed P-256 point (65 bytes)
```

**Pitfall**: Passing SPKI directly to `computeSecret()` fails with "Public key is not valid for specified curve". Must strip the 26-byte prefix first.

## Message Encryption

### Wire Format (Thrift)

The plaintext structure before encryption:
```
MessageEntryHolder {
  contents: MessageEntryContents {    // field 1, struct
    message: MessageContents {        // field 1, struct
      message_text: string            // field 1
      sent_from: int32 = 1            // field 7
    }
  }
}
```

After encryption:
```
MessageCreateEvent {
  contents: bytes (secretbox encrypted)     // field 100
  conversation_key_version: string          // field 101
  should_notify: bool = true                // field 102
  is_pending_public_key: bool = false       // field 105
  priority: int32 = 1                       // field 106
}
```

The `encoded_message_create_event` sent to the API is: `base64(thrift_encode(MessageCreateEvent))`.

### Signature

Preimage format (same for version "3" and "7"):
```
"MessageCreateEvent,{message_id},{sender_id},{conversation_id},{key_version},{base64_nopad(contents_bytes)}"
```

Where `contents_bytes` is the raw secretbox ciphertext (the `MessageCreateEvent.contents` field value).

Signature: ECDSA P-256, SHA-256 hash of preimage, raw `r(32) || s(32)` = 64 bytes, base64 with padding.

**CRITICAL**: Use `signature_version: "7"` when sending (not `"3"`). The server may have recently started enforcing this — messages with version "3" were previously accepted but the X app and webhooks always use "7". Fixed in Go bridge commit `18a3476` (2026-05-31). Our implementation was working with "3" before but switched to "7" for safety.

### MessageEventSignature Thrift
```
MessageEventSignature {
  signature: string (base64)           // field 1
  public_key_version: string           // field 2
  signature_version: string = "3"      // field 3
  signing_public_key: string (SPKI)    // field 4
}
```

## Conversation Management

### Conversation IDs

- 1:1: `{user_id_1}:{user_id_2}` (colon-separated, smaller ID first? or sender:recipient)
- Group: `g{numeric_id}`
- API paths use **dashes** instead of colons: `123456789-987654321`

### Starting New Conversations

- `POST /2/chat/conversations/{recipient_user_id}/messages` — pass recipient's user ID directly
- The server constructs the canonical conversation ID
- `POST /2/chat/conversations/{id}/keys` (initializeChatConversationKeys) — ~~returned 404 in production as of May 2026~~ **working as of July 2026**
- Key initialization is required before sending the first message — without it, messages return 200 OK but are NOT committed
- Flow: init keys → unwrap conversation key → encrypt message → send
- The conversation key change event is delivered via webhook/XAA to the recipient

### Conversation Token

- Server-provided JWT per conversation
- Required for sending messages (included in `MessageEvent.conversation_token`)
- Comes from: webhook events, message responses, conversation data queries
- Format: `{"requestingUser": "...", "recipient": "...", "validSinceMSec": "..."}`

## API Quirks

### GET /2/chat/conversations/{id}/events — Message History ✅

- **NEW** (spec v2.164): `GET /2/chat/conversations/{id}/events` — returns encrypted message events with pagination
- Returns `encoded_event` (thrift MessageEvent with encrypted contents), `message_event_signature`, `sender_id`, `conversation_id`, `created_at_msec`, `conversation_token`
- Supports `max_results` (1-100, default 10) and `pagination_token`
- Accepts recipient user ID (server constructs canonical ID) or dash-separated format
- This is the REST API equivalent of what XAA webhooks deliver — same encrypted payload format
- Decrypt flow is identical: extract contents from MessageEvent thrift → secretbox decrypt → decode MessageEntryHolder

### GET /2/chat/conversations/{id}/messages — DOES NOT EXIST

- Returns **404** regardless of ID format or query params
- Not in the OpenAPI spec — use `/events` instead

### Response Format for Send

`POST /2/chat/conversations/{id}/messages` returns:
```json
{
  "data": {
    "encoded_message_event": "base64(thrift MessageEvent)"
  }
}
```

The response `encoded_message_event` contains the server-assigned `sequence_id`, canonical `conversation_id`, and `conversation_token` for future messages.

### Error Responses

- The API sometimes returns HTML 404 pages instead of JSON — always handle non-JSON responses
- `TwitterResponseError.error` is an **object** (parsed JSON body), not a string — serialize before sending to frontend
- 500 Internal Server Error with `{"title": "Internal Server Error"}` means the encrypted payload was rejected (wrong encryption, wrong signature, or wrong key)

### Silent Failures

- Messages signed with the wrong key or wrong signature version return **200 OK** but the message is not actually delivered
- The server now returns `MessageFailureEvent` with failure types: `InvalidSenderSignature`, `ContentsTooLarge`, `RecipientHasNotTrustedConversation`
- The conversation is not created if the first message has invalid encryption
- Previously (before Go fix `18a3476`): using `signature_version: "3"` caused all messages to be silently dropped. Must use `"7"`.

## TypeScript / Node.js Issues

### tsx and ESM-only Packages

`@noble/curves`, `@noble/hashes`, `@noble/ciphers` are ESM-only. tsx (as of v4.22.0) has issues loading them:
- Static `import { x } from '@noble/curves/ed25519.js'` fails in CJS mode
- Dynamic `import()` returns empty module
- **Fix**: Remove `paths` mappings from `tsconfig.json` that redirect to `.d.ts` files — these confuse tsx's module resolution
- **Fix**: Use Node 22+ where tsx handles ESM properly
- The `tsconfig.json` `paths` workaround (`"@noble/curves/ed25519.js": ["./node_modules/@noble/curves/ed25519.d.ts"]`) **breaks** tsx — it redirects to type declarations instead of actual modules

### Import Extensions

- `@noble/*` packages require `.js` extension in import paths (their `package.json` exports map)
- Our own `.ts` files use extensionless imports (handled by tsx)
- Node 22's `--experimental-strip-types` requires explicit `.ts` extensions (incompatible with existing codebase without tsx)

### cbor-x and Uint8Array

`cbor-x` encodes `Uint8Array` with CBOR typed array tags (tag 64). Juicebox realms expect raw CBOR byte strings (major type 2). **Always wrap in `Buffer.from()`** before encoding.

## Webhook Events

Docs: https://docs.x.com/x-api/webhooks/introduction

### chat.received Payload

```json
{
  "conversation_token": "JWT...",
  "id": "uuid",
  "created_at_msec": "timestamp",
  "sender_id": "user_id",
  "conversation_id": "sender:recipient",
  "conversation_key_version": "timestamp",
  "encoded_event": "base64(thrift MessageEvent with encrypted contents)",
  "conversation_key_change_event": "base64(thrift MessageEvent with KeyChange)",
  "message_event_signature": { "signature": "...", "public_key_version": "...", "signature_version": "7", "signing_public_key": "SPKI..." }
}
```

### Decrypting Webhook Messages

1. Parse `conversation_key_change_event` (base64 → thrift MessageEvent)
2. Find our `encrypted_conversation_key` in the participant keys (match by user_id)
3. Unwrap with our decrypt key (P-256 ECDH + KDF2 + AES-128-GCM)
4. Parse `encoded_event` (base64 → thrift MessageEvent)
5. Extract `MessageCreateEvent.contents` (field 100, bytes)
6. Decrypt with secretbox (XSalsa20-Poly1305) using the conversation key
7. Decode thrift `MessageEntryHolder` → `MessageContents.message_text`

### Signature Version in Webhooks

Webhook `message_event_signature.signature_version` is `"7"` — the same version used for sending. The preimage format is identical to version "3" (`MessageCreateEvent,{msg_id},{sender_id},{conv_id},{key_version},{b64_nopad}`). Only the `signature_version` field value differs.

## Public Keys API Behavior

### Non-Enrolled Users Return Empty Object

`GET /2/users/{id}/public_keys` for a user who hasn't enrolled in XChat returns:
```json
{}
```

HTTP 200, no `data` field, no error. This can be used to check whether a user has XChat enabled.

### Detecting Registration vs Recovery in the UI

The settings endpoint should return a `needs_registration` flag:

| State | `has_private_key` | `needs_registration` | UI Action |
|-------|-------------------|---------------------|------------|
| Keys cached locally | `true` | `false` | Ready to use, no PIN needed |
| Keys on server, not cached | `false` | `false` | Show "Enter PIN to unlock" |
| No keys on server | `false` | `true` | Show "Set up X Chat encryption" |

Detection logic:
1. Check local cache (`data/user-xchat/{userId}.json`) for `private_keys`
2. If not cached, call `GET /2/users/{userId}/public_keys`
3. If response has `public_key` field → enrolled, needs recovery
4. If response is empty `{}` → not enrolled, needs registration

### GraphQL API for Public Keys (from HAR)

The X web client uses a GraphQL endpoint instead of the REST API:
- `GET https://api.x.com/graphql/GJQbOZALDO5D3Zp2IZhH6w/GetPublicKeys?variables={"ids":["..."],"include_juicebox_tokens":true}`
- Returns `public_keys_with_token_map` array (empty for non-enrolled users)
- Includes `chat_permissions.can_dm_on_xchat` boolean

### Enrollment is Opt-In (Not Universal)

Empirical testing (May 2026) shows XChat enrollment is **not automatic**. Many major accounts are not enrolled:
- ❌ @Apple, @Microsoft, @amazon, @Nike, @YouTube, @POTUS
- ❌ News orgs: @CNN, @BBCWorld, @nytimes, @tagesschau
- ✅ @elonmusk, @X, @Tesla, @Google, @OpenAI, @github, @Netflix, @Uber, @Airbnb, @McDonalds, @NASA

Pattern unclear — possibly tied to Premium subscription or manual opt-in via Settings → Privacy → Encrypted messages.

## Storage Architecture

| Store | Key | Contains |
|-------|-----|----------|
| `data/user-xchat/{userId}.json` | user ID | pin, pins (per-version), private_keys (version → { signingKeyB64, decryptKeyB64 }) |
| `data/user-public-keys/{userId}.json` | user ID | public_key (SPKI), signing_public_key (SPKI), version, juicebox_config (DO NOT cache for unlock — tokens expire) |
| `data/conversation-keys/{convId}.json` | conversation ID | encrypted_conversation_key, key_version |

No xchat data is stored on the integration — all xchat data is user-scoped or conversation-scoped.

### Conversation Key Caching Strategy

We cache only the **latest** conversation key per conversation (single key version). This is a performance optimization, not a correctness requirement:

**Why caching is optional:**
- `GET /2/chat/conversations/{id}/events` returns `conversation_key_events` in response metadata — the current key can be extracted on the fly
- Webhooks include `conversation_key_change_event` — key is available inline
- For sending, we only need the current key (not historical ones)

**Why we cache anyway:**
- Avoids re-extracting the key from thrift on every request
- The key extraction involves searching for our user ID in a binary blob — not free
- Most conversations have a single key version that rarely rotates

**What we DON'T store:**
- Historical key versions — if a message was encrypted with an old key we don't have, it shows as `[encrypted — key version unavailable]`
- This is acceptable because the `/events` API provides the current key, and old messages are rare edge cases (key rotation is supported by the protocol but not enforced in practice)

**Key rotation handling:**
- When a new key arrives (webhook or API metadata), we overwrite the cached key
- For sending: always use the most recent key version
- Replies to old messages don't need the old key — the reply preview text is embedded as plaintext in the new message's encrypted payload


## Additional Pitfalls (added 2026-05-16)

### Conversation ID vs Recipient ID for New Messages

When sending to an existing conversation, the frontend passes the conversation ID (e.g. `2055579677322792960:2055625073969508352`). After colon-to-dash replacement it becomes `2055579677322792960-2055625073969508352`. This is valid for `POST /2/chat/conversations/{id}/messages` but **NOT** for fetching the recipient's public key.

Must extract the recipient's user ID from the conversation ID:
```
if (apiConvId.includes('-')) {
  recipientId = parts.find(p => p !== ownUserId) || parts[1];
}
```

When starting a new chat from the follower list, the conversation ID IS the recipient's user ID (no dash) — works directly.


### ~~New Conversation Key Exchange is Broken (as of May 2026)~~ Fixed July 2026

~~- `POST /2/chat/conversations/{id}/keys` (initializeChatConversationKeys) returns **404** in production~~
~~- The documented workflow (init keys → send message) cannot be completed~~
~~- Without key initialization, `POST /messages` returns 200 OK but the message does NOT appear in `GET /events` — the server accepts but doesn't commit it~~
~~- The recipient never receives the conversation key, so even if the message were delivered, they couldn't decrypt it~~
~~- **Workaround**: Only reply to conversations initiated by the other party (via X app), where the key change event is delivered via webhook/XAA or included in the `/events` response metadata (`conversation_key_events`)~~
~~- The X app handles key exchange internally through a different mechanism (possibly WebSocket/GraphQL mutation, not REST API)~~

**Update (2026-07-01):** The endpoint now works. See the "Conversation Key Initialization" section below for the working flow.


### Conversation ID Format: Colons vs Dashes

- **Canonical format** (webhooks, signatures, storage): `2055579677322792960:2055625073969508352` (colon)
- **API URL path format**: `2055579677322792960-2055625073969508352` (dash)
- **Frontend URL param**: uses dash (from the conversation list or follower click)

**Rule**: Always normalize to colon (`:`) for:
- Conversation key storage lookups/saves
- Signature preimage (`conversationId` in the signed string)

Always use dash (`-`) for:
- API endpoint URLs (`/2/chat/conversations/{id}/messages`)

**Pitfall**: Storing keys with `:` but looking up with `-` causes cache misses → triggers unnecessary new conversation initialization.


### Message History via REST API

- `GET /2/chat/conversations/{id}/events` — **WORKS** (added in spec v2.164)
- Returns paginated encrypted events (same format as XAA webhooks)
- `GET /2/chat/conversations/{id}` — works, returns metadata only (type, participants, muted)
- `GET /2/chat/conversations/{id}/messages` — 404, does not exist
- The Go bridge (`mautrix-twitter`) uses a GraphQL endpoint with web session cookies — no longer necessary with the `/events` endpoint


### X Chat Media Upload Not Available (as of May 2026)

The media upload endpoints return **503 Service Unavailable**:
- `POST /2/chat/media/upload/initialize`
- `POST /2/chat/media/upload/{session_id}/append`
- `POST /2/chat/media/upload/{session_id}/finalize`

The migration guide explicitly states these are "NOT YET IN PROD. COMING SOON."


### X Chat Media Download

Docs: https://docs.x.com/enterprise-api/chat/download-chat-media#download-chat-media

The endpoint accepts three ID formats per the docs:
1. Recipient user ID for 1:1 (e.g. `1215441834412953600`) — server constructs canonical ID from authenticated user + recipient
2. Legacy dash-separated 1:1 (e.g. `1215441834412953600-1603419180975409153`)
3. Group ID prefixed with `g` (e.g. `g1234567890123456789`)

Pattern: `^([0-9]{1,19}|[0-9]{1,19}-[0-9]{1,19}|g[0-9]{1,19})$`

#### ~~Previously broken (tested 2026-05-31): 403 Forbidden~~

~~`GET /2/chat/media/{id}/{media_hash_key}` returned **403 Forbidden** regardless of ID format:~~
```
GET /2/chat/media/2055579677322792960-2055625073969508352/uyRoQX6YK0 → 403 (171ms)
{
  "client_id": "28907132",
  "title": "Client Forbidden",
  "required_enrollment": "Appropriate Level of API Access",
  "reason": "client-not-enrolled"
}
```

#### Working (2026-07-01)

The endpoint now works with OAuth2 tokens. Media is returned as **encrypted bytes** using libsodium's `crypto_secretstream_xchacha20poly1305` (NOT plain secretbox).

Decryption flow:
1. Download raw bytes from `GET /2/chat/media/{id}/{media_hash_key}`
2. Decrypt using `secretstreamDecrypt(encryptedBytes, conversationKey)` — the conversation key is the same 32-byte key used for message encryption
3. Format: header (24 bytes) + chunks of 1041 bytes (1024 plaintext + 17 overhead per chunk)
4. Detect content type from magic bytes of decrypted output

Implementation: `proxyXChatMedia` handler in `xchat-handlers.ts` uses `secretstreamDecryptAsync` from `xchat/secretstream.ts` (built on `libsodium-wrappers` package).

The Go bridge (`mautrix-twitter`) downloads media via the TON URL (`https://ton.x.com/1.1/ton/data/xchat_media/{conversation_id}/{media_hash_key}`) using web session cookies — this is an alternative path that also works.


## Media Types (from Go reference)

The `MediaAttachment.type` field (thrift field 3, i32) maps to:

| Value | Type | Notes |
|-------|------|-------|
| 1 | image | JPEG, PNG, WebP |
| 2 | gif | Animated GIF |
| 3 | video | MP4 |
| 4 | audio | Voice messages |
| 5 | file | PDF, documents, any non-media file |
| 6 | svg | SVG images |

Defined in Go as `MediaType` enum in `pkg/twittermeow/data/payload/thrift.go`.

**Pitfall**: The migration guide doesn't document type 5 (file) or 6 (svg). Without the Go source, PDF attachments appear as `unknown(5)`.


## Thrift Codec Architecture

The codebase uses a **generic thrift codec** (`thrift-codec.ts`) with auto-generated schema definitions (`thrift-models.ts`) rather than hand-rolled per-struct encoders/decoders.

- Schemas are generated from Go struct tags: `thrift:"field_name,field_id"`
- 106 schemas covering all message types, events, attachments, entities, group changes, etc.
- `encode(obj, schema)` and `decode(buf, schema)` handle all serialization
- Supports: BOOL, I32, I64, STRING (text + binary), STRUCT (nested), LIST

**Benefit**: Adding support for new message types (reactions, edits, group events) requires zero codec changes — just use the existing schema.

### Field 108 in MessageCreateEvent (Undocumented)

The `MessageCreateEvent` thrift contains an undocumented **field 108** (struct) not present in the Go reference:
- `field_108.1` (32 bytes binary) — unknown purpose, not a nonce (secretbox fails)
- `field_108.2` (72 bytes binary) — decrypts with secretbox to 32 bytes, but does NOT match any hash of the message content (SHA-256, HMAC-SHA256 with conv key or field_108.1 all fail)
- `field_108.4` (list of 72-byte binaries) — present only on messages that have reactions; each entry decrypts to 32 bytes

This is likely a **content integrity/commitment structure** (possibly MLS tree-related), NOT reaction data. The 32-byte decrypted values don't correspond to any obvious hash of the plaintext, ciphertext, or message text.


## Reactions Are Client-Side Aggregated

Reactions are **NOT embedded in the message payload** — neither in the encrypted thrift content nor in the outer MessageEvent structure. They exist only as separate `reaction_add`/`reaction_remove` events referencing the parent message by `message_sequence_id`.

**Confirmed from X client source** (`xchat-kmp.85e9461a.js`, 7.3MB KMP bundle):
- The `com.x.models.dm.DmEntryContents.Message` class has a `reactions` field (field index 3)
- But this field is populated **client-side from a local SQLite database** (`dm_conv_previews` table with columns: `reaction_added_by_user`, `reaction_emoji`, `reaction_added_at_timestamp`, `reaction_added_on_attachment_id`)
- The app processes reaction events from the event stream and stores them locally
- When rendering a message, it enriches the decrypted content with reactions from the local DB

**Our approach** (aggregating reaction events into parent messages in the handler) is identical to what the X app does internally.

### Multiple Reactions Per User

The X Chat protocol allows sending **multiple reactions** to the same message from the same user (different emojis). This is intentional — the X app UI also supports this. A user can react with 👍, 🔥, and 😂 to the same message simultaneously.

### Reaction Event Format
```
MessageEntryHolder {
  contents: MessageEntryContents {
    reaction_add: {           // field 2
      message_sequence_id: string   // target message ID
      emoji: string                 // e.g. "🐳", "👍"
    }
  }
}
```


## Juicebox Key Registration

### Juicebox Registration Bugs Found & Fixed (2026-06-14)

1. **OPRF keys must be Shamir-split, not independent.** Generating random OPRF key pairs per realm breaks recovery because Lagrange interpolation only works on polynomial shares. Fix: generate one master OPRF key, split with `splitScalar()`, distribute shares to realms. **Confirmed from Juicebox SDK Rust source** (`rust/sdk/src/register.rs`): `let oprf_private_key = oprf::PrivateKey::random(); let oprf_private_key_shares = create_shares(oprf_private_key, recover_threshold, share_count)`. The paper describes it abstractly as "each realm gets a random key" but the implementation splits a single master.

2. **Encryption scalar must be reduced mod field order.** `bytesToBigIntLE(randomBytes(32))` can exceed the Ristretto255 order. `splitScalar` reduces it internally, but if the original unreduced value is used for `deriveEncryptionKey`, recovery (which gets the reduced value from interpolation) computes a different encryption key → "invalid tag" on decryption. Fix: reduce before use.

3. **`ed25519.sign()` argument order is `(message, privateKey)`** in `@noble/curves`, not `(privateKey, message)`. Getting this wrong produces a confusing "secretKey expected 32 bytes, got 52" error (52 = size of the OPRF signature message).

4. **`crypto.sign(null, hash, key)` ≠ `crypto.sign('sha256', data, key)` in Node.js.** The former signs the hash as raw data (no internal hashing). The latter hashes internally with SHA-256 then signs. They are mathematically different ECDSA operations. Our `ecdsaSign` (for message signatures) uses the former and works with the X server. The `identity_public_key_signature` requires the latter.

5. **The Juicebox WASM module** (`383a8ef885a5b69ddfdd.module.wasm`, 2.9MB) is the open-source `juicebox-sdk` Rust crate compiled to WASM. Source: `github.com/juicebox-systems/juicebox-sdk`. Contains `struct OprfSignedPublicKey { public_key, verifying_key, signature }` confirming the 3-field structure. Uses `ed25519-compact` for signing, `ciborium` for CBOR, `argon2` for PIN hashing.

### Conversation Key Rotation & Multi-Key Decryption (2026-06-14)

- The API response `meta.conversation_key_events` array (from `GET /2/chat/conversations/{id}/events`) contains ALL historical key versions for a conversation. Only included in the initial request (not when fetching subsequent pages via `pagination_token`). Not present if no key exchange has occurred in the conversation yet.
- Each key event can be decoded with the thrift `MessageEventSchema` → `conversationKeyChangeEvent.conversation_key_version` + `conversation_participant_keys[]`
- Each `MessageCreateEvent` has `conversation_key_version` (field 101) identifying which key encrypted it
- Decryption uses version-based lookup (O(1)), falling back to trying all keys if version not found
- Group events (`group_create`, `group_member_add/remove`) and `conversationKeyChangeEvent` are now rendered in the UI alongside messages

### Registration vs Recovery

- **Recovery** (`Recover1`/`Recover2`/`Recover3`): Retrieves existing secret using PIN. Requires `recover_threshold` (2 of 3) realms.
- **Registration** (`Register1`/`Register2`): Stores a new secret protected by PIN. Requires `register_threshold` (3 of 3) realms.

### Registration Protocol (from HAR capture)

The registration is a **2-phase protocol** (not 3-phase like recovery):

**Software realm (realm-b.x.com):**
- Phase 1: CBOR string `"Register1"` → `{"Register1": "Ok"}`
- Phase 2: CBOR `"Register2"` with OPRF keys + encrypted secret → `{"Register2": "Ok"}`
- Auth: Bearer token in HTTP header (no Noise handshake)

**Hardware realms (realm-east1, realm-west1):**
- Phase 1: Noise NK handshake with `Register1` piggybacked (same as recovery)
- Phase 2: Transport-encrypted `Register2` payload
- Auth: Token in CBOR payload (`auth_token` field)

### Register2 Payload Fields (VERIFIED from HAR CBOR analysis)

From the HAR capture, the `Register2` CBOR struct contains:
- `version` (16 bytes) — random registration version
- `oprf_private_key` (32 bytes) — random Ristretto255 scalar
- `oprf_signed_public_key` — struct with THREE fields:
  - `public_key` (32 bytes) — OPRF Ristretto255 public key
  - `verifying_key` (32 bytes) — **Ed25519 public key** (NOT the same as oprf public key)
  - `signature` (64 bytes) — **Ed25519 signature** over the OPRF public key
- `unlock_key_commitment` (32 bytes)
- `unlock_key_tag` (16 bytes)
- `encryption_key_scalar_share` (32 bytes)
- `encrypted_secret` (variable, ~143 bytes) — PIN-protected key material
- `encrypted_secret_commitment` (16 bytes)
- `policy` — `{ num_guesses: 20 }`

### oprfVerifyingKey and oprfSignature (VERIFIED from CBOR structure)

The X app generates a **separate Ed25519 key pair** per registration and uses it to sign the OPRF public key:

1. Client generates OPRF key pair (Ristretto255 scalar + point)
2. Client generates ephemeral Ed25519 key pair
3. Client signs: `signature = Ed25519.sign(ed25519_priv, msg)`
   where `msg = big_endian_u16(realmId.length) || realmId || u16(oprfPubKey.length) || oprfPubKey`
4. Sends to realm: `{ public_key: oprfPub, verifying_key: ed25519Pub, signature }`
5. On recovery, realm returns all three unchanged
6. Client verifies: `Ed25519.verify(signature, msg, verifying_key)` — ensures realm didn't swap the OPRF public key

**⚠️ BUG in our code** (`client.ts` line 95):
```
oprfVerifyingKey: oprfKeys[i].publicKey, // WRONG — just copies OPRF public key
```
Should: generate Ed25519 keypair, sign the OPRF public key per-realm, and include the signature in the Register2 payload. The `marshalRequest` in `realm.ts` also needs to include the `signature` field in `oprf_signed_public_key`.

Our registration still works because realms accept whatever we send — but on recovery, the signature verification in `recoverPhase2` would fail if the realm returns our incorrect data. (Currently our recovery works because we registered with our own code and the verification passes vacuously.)

### AddXChatPublicKeyMutation

GraphQL mutation to publish public keys to X's server:
- Endpoint: `POST https://api.x.com/graphql/CQsk6GRuWAVabyXqqEG1sA/AddXChatPublicKeyMutation`
- Input: `public_key` (SPKI), `signing_public_key` (SPKI), `identity_public_key_signature`, `registration_method: "CustomPin"`
- Response: Returns `token_map` with fresh Juicebox auth tokens + assigned `version`

**REST API equivalent:** `POST /2/users/{id}/public_keys` (operationId: `addUserPublicKey`) — ~~returned 403 "client-not-enrolled" as of May 2026~~ **working as of July 2026**.

```json
// Request body (ChatAddPublicKeyRequest):
{
  "version": "1780151592870",
  "generate_version": true,
  "public_key": {
    "public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
    "signing_public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
    "identity_public_key_signature": "yo8J8r515+6FBJC6PhVsJlv8fyc3af8ICQ9gPDkZDgG8...",
    "registration_method": "CustomPin"
  }
}
```

Key registration can now be performed entirely from our demo app via the REST API — no need for the X web client or GraphQL mutation.

#### ~~Previously broken (tested May 2026): 403 Forbidden~~

~~The endpoint returned 403 "client-not-enrolled" with our OAuth2 tokens. Same access tier restriction as media download and typing indicators.~~
```
// Response 403 (May 2026):
{
  "client_id": "28907132",
  "detail": "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project. You can create a project via the developer portal.",
  "title": "Client Forbidden",
  "required_enrollment": "Appropriate Level of API Access",
  "reason": "client-not-enrolled",
  "type": "https://api.twitter.com/2/problems/client-forbidden"
}
```

~~**Web client uses:** Bearer token `AAAAAAAAAAAAAAAAAAAAANRILgAA...` (app-level) + `x-csrf-token` + session cookies. Not available to OAuth2 API consumers.~~

~~**Implication:** Key registration (new identity) cannot be performed from our demo app. Users must register their initial encryption keys from the X app itself. Our app can only recover/change PIN for already-registered keys.~~

**Pitfall**: The `version` in the request is a client-generated timestamp, but the server may assign a different `version` in the response. Use the response version for subsequent operations.

### identity_public_key_signature (VERIFIED from HAR + recovered keys)

The `identity_public_key_signature` field in `AddXChatPublicKeyMutation` is a signature proving the client owns the signing private key.

- **Algorithm:** ECDSA P-256 with SHA-256
- **Preimage:** Raw DER bytes of the decrypt (identity) public key in SPKI format (91 bytes)
- **Signer:** The signing private key
- **Signature:** Raw `r||s` (64 bytes) → base64 with padding
- **Verification:** `crypto.verify('sha256', decrypt_pubkey_SPKI_DER, signing_public_key, signature)`

**Verified** using user `hipposchweigt` (2060730035040829440) — recovered private keys from Juicebox match the HAR public keys, and the signature verifies against the raw DER bytes of the decrypt public key. See `scripts/verify-registration-crypto.ts`.

**⚠️ BUG in our code** (`xchat-handlers.ts`): Our implementation uses the WRONG preimage:
```
// WRONG (current code):
const preimage = Buffer.from(`AddXChatPublicKeyMutation,${decryptPublicKeySPKI},${signingPublicKeySPKI}`);
const sig = ecdsaSign(signingScalar, preimage); // ecdsaSign does sign(null, sha256(preimage))

// CORRECT (X app behavior):
const preimage = Buffer.from(decryptPublicKeySPKI, 'base64'); // raw 91-byte DER
const sig = crypto.sign('sha256', preimage, signingPrivKey); // → DER, then convert to r||s
```

The X server apparently accepts both formats (our registration works), but the correct format is just the raw DER bytes.

**Note**: The `registerKeys` handler in `xchat-handlers.ts` calculates this signature and automatically enrolls the generated keys in Juicebox using the user's PIN. This ensures the keys are backed up and can be recovered later. It is called from the UI whenever a user with no registered keys sets up their PIN or manually triggers registration.



## Webhook Payload: No User Information

Webhook `chat.received` events contain only `sender_id` (numeric user ID). No username, display name, or profile image is included in the payload.

**Workaround**: Use `GET /2/users?ids=...` (app bearer token) to resolve user IDs to profiles. Cache aggressively (7-day TTL) since usernames rarely change.

The user lookup endpoint supports batch requests (up to 100 IDs per call) with fields: `name`, `username`, `profile_image_url`, `description`, `public_metrics`, etc.


## XAA Subscriptions Persist After Webhook Deletion

Deleting a webhook via `DELETE /2/webhooks/{id}` does **not** automatically delete the subscriptions associated with it. The API still returns them when queried, and the UI shows orphaned subscriptions tied to a non-existent webhook ID.

**Quirk**: This is server-side behavior — subscriptions must be explicitly deleted before or after removing the webhook. The orphaned subscriptions appear non-functional (no events are delivered) but clutter the subscription list.




## Sending Reactions, Edits, Deletes, and Typing Indicators

### Reactions (Add/Remove)

Reactions use the **same `sendChatMessage` endpoint** as regular messages. The difference is in the encrypted payload — instead of `MessageContents` in the `MessageEntryContents`, it contains `reaction_add` or `reaction_remove`:

```
MessageEntryHolder {
  contents: MessageEntryContents {
    reaction_add: {                    // field 2 (or reaction_remove: field 3)
      message_sequence_id: string      // target message's sequence ID
      emoji: string                    // e.g. "👍", "🐳"
    }
  }
}
```

This is encrypted with secretbox using the conversation key, wrapped in `MessageCreateEvent`, signed, and sent via `POST /2/chat/conversations/{id}/messages` — identical flow to sending a text message.

**No special API endpoint for reactions** — they're just encrypted events sent as messages.

### Message Edits

Same pattern as reactions — the encrypted payload contains `message_edit` instead of `message`:

```
MessageEntryHolder {
  contents: MessageEntryContents {
    message_edit: {                    // field 4
      message_sequence_id: string      // target message's sequence ID
      updated_text: string             // new text
      entities: list<RichTextEntity>   // updated entities (optional)
    }
  }
}
```

Sent via the same `sendChatMessage` endpoint with the same encryption + signing flow.

### Message Deletion

Deletion uses a **different endpoint** — `DeleteMessageMutation` (GraphQL). There is NO REST API endpoint for message deletion.

- GraphQL URL: `POST https://api.x.com/graphql/4gsDQKEmYkOtvsSIpHXdQA/DeleteMessageMutation`
- May work with OAuth2 tokens (untested) or may require web session cookies

It requires:

1. `conversation_id` — the conversation
2. `sequence_ids` — list of message sequence IDs to delete
3. `delete_message_action` — `"ForSelf"` or `"ForAll"`
4. `action_signatures` — signed delete events (signature version "4", not "7")

**Signature preimage for delete (version "4"):**
```
"MessageDeleteEvent,{message_id},{sender_id},{conversation_id},{conversation_token},{created_at_msec},{encoded_message_event_detail}"
```

Where `encoded_message_event_detail` is base64 of thrift-encoded `MessageEventDetail { MessageDeleteEvent { sequence_ids, delete_message_action } }`.

**Delete types:**
- `DeleteForSelf` (action=1) — only removes from your view
- `DeleteForAll` (action=2) — removes for all participants (only works for your own messages)

### Typing Indicators

Typing uses the REST API endpoint — **no encryption needed**:

```
POST /2/chat/conversations/{id}/typing
```

**Status:** ✅ Working as of July 2026. ~~(tested 2026-05-31): Returns **403 "client-not-enrolled"** — same issue as media download.~~ The endpoint exists in the OpenAPI spec and is now available. UI sends typing indicators with 2s initial delay and 5s debounce.

### Reply-To Requires Embedding Original Message Text

Unlike non-encrypted DMs (where you send `parent_id` and the server resolves the referenced message), X Chat replies require the **full original message text** to be embedded in the encrypted payload as `replying_to_preview`.

**Why:** The server cannot read encrypted messages, so it cannot resolve a parent message ID into displayable text for the recipient. The sender must include the preview.

**Implications for bot/API implementations:**
- You cannot reply to a message you haven't already decrypted
- There is no `GET /events/{message_id}` endpoint — to find a specific message, you must paginate through `GET /events` until you find it
- The UI approach (pass the already-displayed text from the frontend) avoids extra API calls
- If building a headless bot that receives a webhook and wants to reply, it must decrypt the incoming message first, then embed that text in the reply

**Contrast with non-encrypted DMs:**
```
// Non-encrypted: just send parent_id, server resolves the rest
POST /2/dm_conversations/{id}/messages { text, reply: { in_reply_to_message_id } }

// Encrypted: must embed the full preview in the encrypted payload
MessageContents {
  message_text: "my reply",
  replying_to_preview: {
    sender_id, message_text, sender_display_name,
    replying_to_message_sequence_id, replying_to_message_id
  }
}
```

### Implementation Summary

| Operation | Endpoint | Encrypted Payload | Signature Version |
|-----------|----------|-------------------|-------------------|
| Send message | `POST /messages` | `MessageEntryContents.message` | "7" |
| Send reply | `POST /messages` | `MessageEntryContents.message` + `replying_to_preview` | "7" |
| Add reaction | `POST /messages` | `MessageEntryContents.reaction_add` | "7" |
| Remove reaction | `POST /messages` | `MessageEntryContents.reaction_remove` | "7" |
| Edit message | `POST /messages` | `MessageEntryContents.message_edit` | "7" |
| Delete message | GraphQL `DeleteMessageMutation` | Thrift `MessageDeleteEvent` (not secretbox) | "4" |
| Typing indicator | `POST /typing` | None | None |


## Group Member Changes and Key Rotation

**Tested 2026-05-31** on group `g2061081815574561070`:

### Member Removal → NO Key Rotation
- `group_member_remove` event appears in `GET /events`
- **No new key version generated** — remaining members still use the original key (`1780235173093`)
- The removed member retains the old key (no post-removal secrecy)
- **No XAA webhook delivered** for the removal

### Member Re-Added → Key IS Rotated
- `group_member_add` event + `conversation_key_change_event` with new key version
- New key version `1780250974432` generated (was `1780235173093`)
- Participant keys wrapped for all 3 members (including re-added one)
- The re-added member **cannot see old messages** (only has the new key — confirmed in X app UI)
- `conversation_key_events` in API metadata now contains 2 key entries
- **No XAA webhook delivered** for the addition either

### Security Implications
- **Forward secrecy on add:** New members can't read history (key rotated)
- **No forward secrecy on remove:** Removed members could decrypt future messages (key NOT rotated)
- This is a deliberate trade-off: privacy of existing conversation > post-removal security

### Missing Webhook Event Types
XAA subscriptions only deliver `chat.received` and `chat.sent`. The following events are NOT delivered via webhook (even with `conversation.join` subscription):
- `group_member_remove` / `group_member_add`
- `group_title_change` / `group_avatar_change`
- `conversation_key_change_event` (standalone)
- `conversation_delete`

These events are only visible by polling `GET /2/chat/conversations/{id}/events`.

### Group Event JSON Examples (from API)

**group_member_remove** (user left):
```json
{
  "id": "2061146716716642304",
  "created_at_msec": "1780250646177",
  "sender_id": "2055625073969508352",
  "conversation_id": "g2061081815574561070",
  "message_event_signature": { "signature": "...", "signature_version": "7", ... },
  "encoded_event": "<thrift: groupChangeEvent.group_member_remove>"
}
```
Decoded thrift `detail.groupChangeEvent`:
```json
{
  "group_change": {
    "group_member_remove": {
      "member_ids": ["2055625073969508352"]
    }
  }
}
```

**group_member_add** (admin re-added user) — triggers key rotation:
```json
{
  "id": "2061148095422111744",
  "created_at_msec": "1780250974885",
  "sender_id": "2060730035040829440",
  "conversation_id": "g2061081815574561070",
  "message_event_signature": { "signature": "...", "signature_version": "7", ... },
  "encoded_event": "<thrift: groupChangeEvent.group_member_add>"
}
```
Decoded thrift `detail.groupChangeEvent`:
```json
{
  "group_change": {
    "group_member_add": {
      "member_ids": ["2055625073969508352"],
      "current_member_ids": ["2055579677322792960", "2060730035040829440"],
      "current_admin_ids": ["2060730035040829440"],
      "conversation_key_version": "1780250974432"
    }
  }
}
```

**conversation_key_change_event** (new key distributed with member add):
```json
{
  "id": "2061148095174627571",
  "created_at_msec": "1780250974830",
  "sender_id": "2060730035040829440",
  "encoded_event": "<thrift: conversationKeyChangeEvent>"
}
```
Decoded thrift `detail.conversationKeyChangeEvent`:
```json
{
  "conversation_key_version": "1780250974432",
  "conversation_participant_keys": [
    { "user_id": "2055625073969508352", "public_key_version": "1778934541573", "encrypted_conversation_key": "<152 chars>" },
    { "user_id": "2055579677322792960", "public_key_version": "1778923517205", "encrypted_conversation_key": "<152 chars>" },
    { "user_id": "2060730035040829440", "public_key_version": "1780151593317", "encrypted_conversation_key": "<152 chars>" }
  ],
  "ratchet_tree": null
}
```

**Note:** The `conversation_key_change_event` is a separate event (different sequence ID) from the `group_member_add` event, but they share the same `conversation_key_version`. The key change event always precedes the group change event chronologically.

### `POST /2/chat/conversations/{id}/keys` — Conversation Key Initialization

The OpenAPI spec states that `POST /2/chat/conversations/{id}/keys` accepts a recipient user ID for 1:1 conversations (same as `/events` and `/messages` endpoints), and that "this is the first step before sending messages in a new 1:1 conversation."

#### ~~Previously broken (tested 2026-06-24): 404~~

~~The endpoint returned **404** for new conversations that have no prior message history, regardless of the ID format used:~~
- ~~Recipient user ID only: `POST /2/chat/conversations/2055579677322792960/keys` → 404~~
- ~~Full sender-recipient: `POST /2/chat/conversations/2060730035040829440-2055579677322792960/keys` → 404~~
- ~~Canonical lower-first: `POST /2/chat/conversations/2055579677322792960-2060730035040829440/keys` → 404~~

#### Working (2026-07-01)

The endpoint now works correctly. Passing the **recipient user ID** as the conversation ID initiates key exchange for a new 1:1 conversation:

```
POST /2/chat/conversations/2060730035040829440/keys → 200 (237ms)
```

Response includes the initialized key version and participant count. After key initialization, `POST /messages` successfully commits the message (appears in `GET /events`).

Full working flow for new conversations:
1. Detect no cached conversation key for the recipient
2. `POST /2/chat/conversations/{recipientId}/keys` — initializes key exchange, returns key version + participant keys
3. Unwrap our conversation key from the response (same ECDH + KDF2 + AES-128-GCM flow)
4. Cache the key with canonical ID (`smallerId:largerId`, BigInt-sorted)
5. Encrypt message with secretbox using the new conversation key
6. `POST /2/chat/conversations/{recipientId}/messages` — message is committed
7. `GET /2/chat/conversations/{recipientId}/events` — confirms message appears

**Important**: The canonical conversation key ID must be constructed as `smallerId:largerId` (numerically sorted using BigInt comparison), even when the API call uses just the recipient ID. This ensures cache lookups work correctly for subsequent messages.

### No way to distinguish encrypted vs legacy conversations from conversation metadata (2026-06-24)

The `GET /2/chat/conversations` response does not include any field indicating whether a conversation is encrypted. Available fields are: `admin_ids`, `created_at`, `group_avatar_url`, `group_name`, `id`, `is_muted`, `member_ids`, `message_ttl_msec`, `participant_ids`, `screen_capture_blocking_enabled`, `screen_capture_detection_enabled`, `type`, `updated_at` — none of which indicate encryption status.

The only way to determine if a conversation is encrypted is to fetch events via `GET /2/chat/conversations/{id}/events` and check for the presence of `meta.conversation_key_events` in the response. If present, the conversation has had a key exchange and messages are encrypted. If absent, either:
1. The conversation is a legacy (unencrypted) DM conversation, or
2. No key exchange has occurred yet (new conversation between enrolled users)

There is no `is_encrypted` field. Fields like `screen_capture_blocking_enabled` and `screen_capture_detection_enabled` are defined in the OpenAPI spec and can be requested, but are not returned even for known-encrypted conversations.

### Message deletion is GraphQL-only, not available via REST API (2026-07-08)

The REST API `POST /2/chat/conversations/{id}/messages` (`sendChatMessage`) only accepts `MessageCreateEvent` payloads. Sending a `MessageEventDetail` with a `messageDeleteEvent` (field 7) returns HTTP 200 but the response `encoded_message_event` contains a `messageFailureEvent` with `failure_type: 14` (undocumented, beyond the known enum 1-9).

**Known FailureType values** (from `chat-xdk` Rust source):
| Value | Name |
|-------|------|
| 1 | EMPTY_DETAIL |
| 2 | INTERNAL_ERROR |
| 3 | CONTENTS_TOO_LARGE |
| 4 | TOO_MANY_MESSAGES |
| 5 | INVALID_SENDER_SIGNATURE |
| 6 | NON_LATEST_CKEY_VERSION |
| 7 | RECIPIENT_HAS_NOT_TRUSTED_CONVERSATION |
| 8 | RECIPIENT_KEY_HAS_CHANGED |
| 9 | ONLY_ENCRYPTED_MESSAGES_ALLOWED |
| 14 | Unknown — returned when sending MessageDeleteEvent via REST |

**How the X app deletes messages**: GraphQL mutation `DeleteMessageMutation` at `POST https://api.x.com/graphql/4gsDQKEmYkOtvsSIpHXdQA/DeleteMessageMutation` with session-based auth (cookies + `x-csrf-token`). The request body has `variables` as a JSON-encoded string containing:
```json
{
  "sequence_ids": ["<message_id>"],
  "conversation_id": "<canonical_id>",
  "delete_message_action": "DeleteForAll",
  "action_signatures": [{
    "encoded_message_event_detail": "<base64 thrift MessageEventDetail with field 7>",
    "message_event_signature": {
      "public_key_version": "<version>",
      "signature": "<base64 ECDSA signature>",
      "signature_version": "7",
      "signing_public_key": null
    },
    "message_id": "<uuid>",
    "signature_payload": "MessageDeleteEvent,<msgId>,<senderId>,<convId>,<action>,<seqId>"
  }]
}
```

Response: `{"data":{"xchat_delete_messages":{"__typename":"DeleteMessageResponse"}}}`

**OAuth2 tokens cannot call this endpoint** — returns 403 with empty body. The GraphQL endpoint requires web session authentication (cookies), not OAuth2 bearer tokens.

**However, delete events sent via GraphQL DO appear in the events timeline** as proper `messageDeleteEvent` entries with `relay_source: 1`, `is_trusted: true`, and a full `message_event_signature`. Example decoded event:
```json
{
  "sequence_id": "2074805751617384448",
  "message_id": "99f595d0-...",
  "sender_id": "2055625073969508352",
  "detail": {
    "messageDeleteEvent": {
      "sequence_ids": ["2074584766276386817"],
      "delete_message_action": 2
    }
  },
  "relay_source": 1,
  "is_trusted": true,
  "message_event_signature": { ... }
}
```
The REST `sendChatMessage` endpoint rejects these (failure_type 14), but the GraphQL mutation creates them successfully and they propagate to all participants via the events timeline.

**Note on `sendChatMessage` response handling**: The REST API returns HTTP 200 even on failure — the error is encoded in the thrift `encoded_message_event` response field as a `messageFailureEvent`. Added `checkMessageFailure()` helper to decode and surface these errors as HTTP 422 in our handlers.

### Per-message TTL (disappearing messages) (2026-07-08)

Individual messages can have a TTL set via `ttl_msec` (field 103) on `MessageCreateEvent`. This is separate from the conversation-level `message_ttl_msec` setting.

**How it works**:
- Set `ttl_msec` on the `MessageCreateEvent` thrift struct when encrypting/encoding the message
- The API accepts it and the message is delivered normally
- The X app enforces the TTL client-side — after the timer expires, the message is hidden from the UI
- Server-side deletion is delayed: a 5-second TTL resulted in ~30 seconds before the message disappeared from the events timeline
- There is no server push notification when a message expires — clients must track timers locally

**Related thrift schemas**:
- `MessageCreateEvent` field 103: `ttl_msec` (i64) — per-message TTL
- `MessageDurationChangeEvent` field 1: `ttl_msec` (i64) — conversation-level TTL change event
- `MessageDurationRemoveEvent` field 1: `current_ttl_msec` (i64) — TTL removal event
- `MessageEventDetail` field 8: `messageDurationChangeEvent` — wrapper for TTL change
- `MessageEventDetail` field 9: `messageDurationRemoveEvent` — wrapper for TTL removal

**Conversation-level TTL**: The `message_ttl_msec` field on conversation metadata (returned by `GET /2/chat/conversations`) indicates the default TTL for all messages in that conversation. Per-message TTL overrides this.

**Webhook delivery**: TTL messages are delivered via webhooks like normal messages. The `ttl_msec` field is present in the decoded `MessageCreateEvent` and can be extracted from `fullEvent.detail?.messageCreateEvent?.ttl_msec`.

### Reactions quirks (2026-07-08)

**Reactions use the same encryption/signing flow as regular messages**. The signature preimage is identical: `MessageCreateEvent,{msgId},{senderId},{convId},{keyVersion},{contentsB64NoPad}` — the server doesn't know or care whether the encrypted payload is a message, reaction, or edit.

**Multiple reactions per user**: A user can add multiple different emoji reactions to the same message. Each is a separate encrypted event. Removing a reaction also requires sending a separate `reaction_remove` event.

**Reaction events reference parent by sequence_id**: The encrypted payload contains `message_sequence_id` pointing to the target message. If the target message is not in the current page of events, the reaction appears as an orphan.

**Reactions are NOT included in the `sendChatMessage` response**: When you send a reaction, the response `encoded_message_event` only confirms the event was accepted (returns the event metadata). It does not echo back the reaction content.

**Reactions on expired/deleted messages**: Reactions can still be sent to messages that have expired (TTL) or been deleted. The server accepts them without error. The X app simply doesn't display reactions on messages that are no longer visible.

**Edit quirk — no server-side author validation (CONFIRMED)**: Edits use the same flow. The encrypted payload contains `message_edit` with `message_sequence_id` and `updated_text`. The server does NOT validate that the edit sender is the original message author — any conversation participant can send an edit event targeting any other participant's messages, and the server accepts it with a new `sequence_id`.

**However, the X app ignores cross-user edits client-side**: After hyenamusk edited hippotalks' message (original text: "nic"), the X app still displayed the original text "nic" — it silently discards edit events where the edit sender doesn't match the original message sender. The edit event IS present in the conversation events response (and our UI applied it), but the X app's rendering logic filters it out.

**Implication for our UI**: We should also validate that `edit.sender_id === original_message.sender_id` before applying edits, otherwise a malicious participant could alter displayed text in our client.

**Edit quirk — no target type validation**: The server also doesn't validate that the edit target is a regular message. In testing, hyenamusk "edited" a `messageDeleteEvent` (not a message) and the server accepted it. The X app UI showed "you edited..." regardless of the target event type.
