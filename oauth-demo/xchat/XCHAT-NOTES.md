# X Chat Implementation Notes & Pitfalls

> Living document of gotchas, undocumented behaviors, and lessons learned while implementing X Chat E2E encryption.

## Encryption Stack (Verified)

The official migration guide and chat-xdk documentation are **misleading** about the actual crypto primitives used. The correct stack was reverse-engineered from the Go reference implementation at `mautrix-twitter` (`pkg/twittermeow/crypto/`).

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
- `POST /2/chat/conversations/{id}/keys` (initializeChatConversationKeys) — returned **404 in production** as of May 2026
- Sending a properly encrypted message to a new recipient works without explicit key initialization
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

Webhook `message_event_signature.signature_version` is `"7"` (not `"3"` as used for sending). This may indicate a different preimage format for verification.

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
1. Check local cache (`data/user-xchat/{userId}.json`) for `private_key`
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
| `data/user-xchat/{userId}.json` | user ID | PIN, private_key (JSON with signingKeyB64 + decryptKeyB64), signing_key_version |
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
- This is acceptable because the `/events` API provides the current key, and old messages are rare edge cases (key rotation only happens on member changes)

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


### New Conversation Key Exchange is Broken (as of May 2026)

- `POST /2/chat/conversations/{id}/keys` (initializeChatConversationKeys) returns **404** in production
- The documented workflow (init keys → send message) cannot be completed
- Without key initialization, `POST /messages` returns 200 OK but the message does NOT appear in `GET /events` — the server accepts but doesn't commit it
- The recipient never receives the conversation key, so even if the message were delivered, they couldn't decrypt it
- **Workaround**: Only reply to conversations initiated by the other party (via X app), where the key change event is delivered via webhook/XAA or included in the `/events` response metadata (`conversation_key_events`)
- The X app handles key exchange internally through a different mechanism (possibly WebSocket/GraphQL mutation, not REST API)


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


### X Chat Media Download Requires Higher Access Level

Docs: https://docs.x.com/enterprise-api/chat/download-chat-media#download-chat-media

`GET /2/chat/media/{id}/{media_hash_key}` returns **403 Forbidden** regardless of ID format (recipient user ID, dash-separated, or colon-separated):

```json
{
  "client_id": "28907132",
  "detail": "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project. You can create a project via the developer portal.",
  "registration_url": "https://developer.twitter.com/en/docs/projects/overview",
  "title": "Client Forbidden",
  "required_enrollment": "Appropriate Level of API Access",
  "reason": "client-not-enrolled",
  "type": "https://api.twitter.com/2/problems/client-forbidden"
}
```

This endpoint requires a developer app attached to a Project with appropriate access level. Standard OAuth2 tokens are not sufficient.

The endpoint accepts three ID formats per the docs:
1. Recipient user ID for 1:1 (e.g. `1215441834412953600`) — server constructs canonical ID from authenticated user + recipient
2. Legacy dash-separated 1:1 (e.g. `1215441834412953600-1603419180975409153`)
3. Group ID prefixed with `g` (e.g. `g1234567890123456789`)

Pattern: `^([0-9]{1,19}|[0-9]{1,19}-[0-9]{1,19}|g[0-9]{1,19})$`

Despite being documented, the endpoint returns 403 "client-not-enrolled" for our OAuth2 tokens even with Enterprise tier access. Likely not yet implemented or requires additional whitelisting from X's side.

Tested 2026-05-31:
```
GET /2/chat/media/2055579677322792960-2055625073969508352/uyRoQX6YK0 → 403 (171ms)
{
  "client_id": "28907132",
  "detail": "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project. You can create a project via the developer portal.",
  "registration_url": "https://developer.twitter.com/en/docs/projects/overview",
  "title": "Client Forbidden",
  "required_enrollment": "Appropriate Level of API Access",
  "reason": "client-not-enrolled",
  "type": "https://api.twitter.com/2/problems/client-forbidden"
}
```

The Go bridge (`mautrix-twitter`) downloads media via the TON URL (`https://ton.x.com/1.1/ton/data/xchat_media/{conversation_id}/{media_hash_key}`) using web session cookies, not the REST API.


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

### Register2 Payload Fields

From the HAR capture, the `Register2` CBOR struct contains:
- `version` — realm state version (from `realm_state` in token_map response)
- `oprf_private_key` (32 bytes) — random Ristretto255 scalar
- `oprf_signed_public_key` — struct with `public_key` (32 bytes) and `verifying_key` (32 bytes)
- Encrypted secret data (the PIN-protected key material)
- Policy/guess count configuration

### AddXChatPublicKeyMutation

GraphQL mutation to publish public keys to X's server:
- Endpoint: `POST https://api.x.com/graphql/CQsk6GRuWAVabyXqqEG1sA/AddXChatPublicKeyMutation`
- Input: `public_key` (SPKI), `signing_public_key` (SPKI), `identity_public_key_signature`, `registration_method: "CustomPin"`
- Response: Returns `token_map` with fresh Juicebox auth tokens + assigned `version`

**Pitfall**: The `version` in the request is a client-generated timestamp, but the server may assign a different `version` in the response. Use the response version for subsequent operations.

### identity_public_key_signature

The `identity_public_key_signature` field in `AddXChatPublicKeyMutation` is a signature proving the client owns the private key. Format and preimage TBD — likely ECDSA P-256 over some canonical representation of the public keys.



## Webhook Payload: No User Information

Webhook `chat.received` events contain only `sender_id` (numeric user ID). No username, display name, or profile image is included in the payload.

**Workaround**: Use `GET /2/users?ids=...` (app bearer token) to resolve user IDs to profiles. Cache aggressively (7-day TTL) since usernames rarely change.

The user lookup endpoint supports batch requests (up to 100 IDs per call) with fields: `name`, `username`, `profile_image_url`, `description`, `public_metrics`, etc.


## XAA Subscriptions Persist After Webhook Deletion

Deleting a webhook via `DELETE /2/webhooks/{id}` does **not** automatically delete the subscriptions associated with it. The API still returns them when queried, and the UI shows orphaned subscriptions tied to a non-existent webhook ID.

**Quirk**: This is server-side behavior — subscriptions must be explicitly deleted before or after removing the webhook. The orphaned subscriptions appear non-functional (no events are delivered) but clutter the subscription list.


