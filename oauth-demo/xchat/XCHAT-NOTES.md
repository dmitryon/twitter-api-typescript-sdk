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

Preimage format (signature version "3"):
```
"MessageCreateEvent,{message_id},{sender_id},{conversation_id},{key_version},{base64_nopad(contents_bytes)}"
```

Where `contents_bytes` is the raw secretbox ciphertext (the `MessageCreateEvent.contents` field value).

Signature: ECDSA P-256, SHA-256 hash of preimage, raw `r(32) || s(32)` = 64 bytes, base64 with padding.

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

### GET /2/chat/conversations/{id} (Message History) — DOES NOT EXIST

- Listed in the migration guide but **not in the OpenAPI spec** and **returns 404 in production**
- This endpoint does not work — message history is only available via XAA webhooks/stream or the internal GraphQL API (requires web session cookies, not OAuth2)
- See "No REST API for Message History" section below for details

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

- Messages signed with the wrong key return **200 OK** but the message is not actually delivered
- The conversation is not created if the first message has invalid encryption
- No error is returned — you only discover this by checking if the conversation appears in the recipient's inbox

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

## Storage Architecture

| Store | Key | Contains |
|-------|-----|----------|
| `data/user-xchat/{userId}.json` | user ID | PIN, private_key (JSON with signingKeyB64 + decryptKeyB64), signing_key_version |
| `data/user-public-keys/{userId}.json` | user ID | public_key (SPKI), signing_public_key (SPKI), version, juicebox_config (DO NOT cache for unlock — tokens expire) |
| `data/conversation-keys/{convId}.json` | conversation ID | encrypted_conversation_key, key_version |

No xchat data is stored on the integration — all xchat data is user-scoped or conversation-scoped.


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
- Without this endpoint, there's no way to register conversation keys for a new conversation via the API
- The server accepts messages with 200 OK even without key registration, but the **recipient cannot decrypt** them (they never receive the conversation key)
- **Workaround**: Only reply to conversations initiated by the other party (via X app), where the key change event is delivered via webhook/XAA
- The X app handles key exchange internally through a different mechanism (possibly WebSocket-based, not REST API)


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


### No REST API for Message History

- `GET /2/chat/conversations/{id}` is mentioned in the migration guide but **not in the OpenAPI spec** and returns 404 in production
- The Go bridge (`mautrix-twitter`) uses a **GraphQL endpoint**: `GET https://api.x.com/graphql/uQEDp5FgdqNiG2jT5q07Jw/GetInboxPageConversationDataRequestQuery?variables={"conversation_id":"..."}` 
- This GraphQL endpoint requires **web session auth** (cookies + CSRF token), NOT OAuth2
- It's the internal Twitter web client API, not the public developer API
- **Conclusion**: Message history is only available via XAA webhooks/stream (real-time) or by implementing the full web client login flow (cookies, not OAuth2)


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


## Webhook Payload: No User Information

Webhook `chat.received` events contain only `sender_id` (numeric user ID). No username, display name, or profile image is included in the payload.

**Workaround**: Use `GET /2/users?ids=...` (app bearer token) to resolve user IDs to profiles. Cache aggressively (7-day TTL) since usernames rarely change.

The user lookup endpoint supports batch requests (up to 100 IDs per call) with fields: `name`, `username`, `profile_image_url`, `description`, `public_metrics`, etc.


## XAA Subscriptions Persist After Webhook Deletion

Deleting a webhook via `DELETE /2/webhooks/{id}` does **not** automatically delete the subscriptions associated with it. The API still returns them when queried, and the UI shows orphaned subscriptions tied to a non-existent webhook ID.

**Quirk**: This is server-side behavior — subscriptions must be explicitly deleted before or after removing the webhook. The orphaned subscriptions appear non-functional (no events are delivered) but clutter the subscription list.


