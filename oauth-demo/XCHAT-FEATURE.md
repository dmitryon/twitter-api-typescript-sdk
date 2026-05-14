# X Chat Feature — Requirements, Design & Tasks

> Reference: [XChat Migration Guide](./XCHAT-MIGRATION-GUIDE.md) | [XChat PDF](../XChat_Beta_Enterprise_User_Migration_Guide_v1.pdf)

## Requirements

### Functional Requirements

1. **Chat Mode Selection** — When user clicks "💬 Chat", choose between Legacy DM or X Chat.

2. **X Chat: PIN Management** — User provides their 4-digit numeric PIN (set in the X app). Stored on the integration. Used to retrieve the private key from Juicebox. Required before any chat operation.

3. **X Chat: List Conversations** — `GET /2/chat/conversations`

4. **X Chat: View Messages** — `GET /2/chat/conversations/{id}` (paginated, encrypted payloads displayed raw — decryption requires chat-xdk, Rust/Python only)

5. **X Chat: Send Messages** — `POST /2/chat/conversations/{id}/messages`. Best-effort: base64-encoded plaintext JSON as `encoded_message_create_event` (real flow requires chat-xdk encryption).

6. **X Chat: Upload Media** — 3-step: initialize → append (chunked) → finalize → `media_hash_key`

7. **X Chat: Download Media** — `GET /2/chat/media/{id}/{media_hash_key}` or TON URL `https://ton.x.com/1.1/ton/data/xchat_media/{conversation_id}/{media_hash_key}`

8. **X Chat: Get User Public Keys** — `GET /2/users/{id}/public_keys`

9. **X Chat: Real-time Events (XAA)** — Subscribe to `chat.received` / `chat.sent` via `POST /2/activity/subscriptions` with `webhook_id`. Events arrive as webhook POSTs to the existing receiver, logged and broadcast via the same `webhookEventBus`, displayed in the "📨 Events" modal with a 🔐 icon.

### Non-Functional Requirements

- X Chat requires **OAuth2** only.
- XAA create/list: BearerToken, OAuth2, or OAuth1. XAA delete: BearerToken only.
- PIN is 4 digits, stored on integration. Private key and conversation keys cached on integration. Never returned in API responses — only presence reported.
- Legacy DM flow and Account Activity webhooks remain fully functional.

---

## Design

### Key Storage Model

```
Integration.xchat {
  pin: string                          // 4-digit, set by user in X app
  private_key?: string                 // cached from Juicebox (expensive to retrieve)
  public_key_version?: string          // to detect key rotation
  conversation_keys?: Record<id, key>  // decrypted symmetric keys per conversation
}
```

Private key and conversation keys are never returned in API responses — only `has_pin`, `has_private_key`, `conversation_key_count` are exposed.

### Similarities: Legacy DM vs X Chat

| Aspect | Legacy DM | X Chat |
|--------|-----------|--------|
| Auth | OAuth1 or OAuth2 | OAuth2 only |
| List conversations | followers list | `GET /2/chat/conversations` |
| Get messages | `GET /2/dm_events` by participant | `GET /2/chat/conversations/{id}` (encrypted) |
| Send message | `POST /2/dm_conversations/.../messages` | `POST /2/chat/conversations/{id}/messages` (encrypted) |
| Media upload | INIT/APPEND/FINALIZE → `media_id` | initialize/append/finalize → `media_hash_key` |
| Media download | TON URL via `dmConversationsMediaDownload` | `GET /2/chat/media/{id}/{media_hash_key}` |
| Real-time events | Account Activity API (webhooks) | X Activity API — XAA (webhooks or stream) |

### Architecture

```
oauth-demo/
├── handlers/
│   ├── handler-utils.ts        resolveAuth(), sseResponse(), shared mediaCache  [DONE]
│   ├── dm-handlers.ts          legacy DM — refactored to use handler-utils      [DONE]
│   ├── media-handlers.ts       legacy media — refactored to use handler-utils   [DONE]
│   ├── xchat-handlers.ts       X Chat conversations/messages/media/settings     [DONE]
│   └── xaa-handlers.ts         XAA subscription management                      [DONE]
├── public/
│   ├── app.js                  chat mode selection, xchat event classification  [DONE]
│   ├── xchat.js                X Chat UI: PIN, conversations, messages, XAA     [DONE]
│   └── style.css               X Chat styles                                    [DONE]
├── oauth-demo.ts               all new routes registered                        [DONE]
└── types.ts                    Integration.xchat field                          [DONE]
```

### New Backend Routes

| Method | Route | Handler | Description |
|--------|-------|---------|-------------|
| GET | `/integrations/:id/xchat/settings` | `getXChatSettings` | Get xchat config (presence only, no secrets) |
| PATCH | `/integrations/:id/xchat/settings` | `updateXChatSettings` | Save PIN / private key / conversation keys |
| GET | `/integrations/:id/xchat/conversations` | `getXChatConversations` | List chat conversations |
| GET | `/integrations/:id/xchat/conversations/:conversationId/messages` | `getXChatMessages` | Get messages |
| POST | `/integrations/:id/xchat/conversations/:conversationId/send` | `sendXChatMessage` | Send message |
| POST | `/integrations/:id/xchat/media/upload` | `uploadXChatMedia` | 3-step upload (SSE progress) |
| GET | `/integrations/:id/xchat/media/proxy` | `proxyXChatMedia` | Download/proxy xchat media |
| GET | `/integrations/:id/xchat/users/:userId/public-keys` | `getUserPublicKeys` | Get user public keys |
| GET | `/integrations/:id/xaa/subscriptions` | `getXAASubscriptions` | List XAA subscriptions |
| POST | `/integrations/:id/xaa/subscriptions` | `createXAASubscription` | Create chat event subscription |
| DELETE | `/integrations/:id/xaa/subscriptions/:subscriptionId` | `deleteXAASubscription` | Delete subscription |

---

## Implemented Flows

### PIN Setup Flow

```plantuml
@startuml
title X Chat PIN Setup

actor User
participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xchat-handlers)" as BE
database "Integration\n(storage)" as DB

User -> UI: Click "🔐 X Chat"
UI -> BE: GET /integrations/:id/xchat/settings
BE -> DB: load integration
DB --> BE: integration
BE --> UI: { xchat: { has_pin: false } }
UI -> User: Show 4-digit PIN prompt\n"Enter PIN from X app Chat settings"
User -> UI: Enter 4-digit PIN (auto-submits)
UI -> BE: PATCH /integrations/:id/xchat/settings\n{ pin: "1234" }
BE -> BE: Validate: /^[0-9]{4}$/
BE -> DB: save integration.xchat.pin
DB --> BE: saved
BE --> UI: { success: true, xchat: { has_pin: true } }
UI -> UI: showTab('conversations')
@enduml
```

### Getting User Messages Flow

```plantuml
@startuml
title Getting User Messages

actor User
participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xchat-handlers)" as BE
participant "X Servers" as X
database "Integration\n(storage)" as DB

note over UI, BE: PIN already set (has_pin: true)

User -> UI: Open X Chat
UI -> BE: GET /xchat/conversations?auth=oauth2
BE -> X: GET /2/chat/conversations
X --> BE: List of conversations (encrypted metadata)
BE --> UI: conversations[]
UI -> User: Show conversation list\n(direct 💬 / group 👥)

User -> UI: Click conversation
UI -> BE: GET /xchat/conversations/:id/messages?auth=oauth2
BE -> X: GET /2/chat/conversations/:id
X --> BE: Encrypted messages
BE --> UI: messages[] (encrypted payloads)
UI -> User: Display messages with\n[encrypted] indicator\n⚠️ Decryption requires chat-xdk
@enduml
```

### Sending a Message Flow

```plantuml
@startuml
title Sending a Message

actor User
participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xchat-handlers)" as BE
participant "X Servers" as X
database "Integration\n(storage)" as DB

User -> UI: Type message + click Send
UI -> BE: POST /xchat/conversations/:id/send\n{ text, media_hash_key? }

BE -> DB: load integration.xchat
DB --> BE: { pin, private_key?, conversation_keys? }

alt PIN not set
  BE --> UI: 400 { error: "X Chat PIN not set" }
  UI -> User: Show error
else PIN set
  note over BE
    TODO (requires chat-xdk in TypeScript):
    1. If private_key not cached:
       retrieve from Juicebox using PIN + public_keys
    2. Decrypt conversation key using private_key
    3. Encrypt message using conversation key
    4. Serialize as Thrift MessageCreateEvent → base64
    ---
    Current stub: base64(JSON({ text, media_hash_key }))
  end note
  BE -> BE: Build encoded_message_create_event (stub)\nGenerate message_id (UUID)
  BE -> X: POST /2/chat/conversations/:id/messages\n{ encoded_message_create_event, message_id }
  X --> BE: Response
  BE --> UI: Response
  UI -> User: Show result
end
@enduml
```

The backend gates on PIN presence — if no PIN is stored, the request is rejected before reaching the API. The `state.pin` in the frontend is retained for the future real encryption path (when chat-xdk TypeScript bindings become available).

### Media Upload Flow

```plantuml
@startuml
title X Chat Media Upload (3-step)

actor User
participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xchat-handlers)" as BE
participant "X Servers" as X

User -> UI: Select file attachment
UI -> BE: POST /xchat/media/upload\n{ media: base64, conversation_id }\n(SSE response)
BE --> UI: SSE: { step: 'init' }
BE -> X: POST /2/chat/media/upload/initialize\n{ total_bytes, conversation_id }
X --> BE: { session_id, media_hash_key }

loop for each 3MB chunk
  BE --> UI: SSE: { step: 'append', detail: 'segment N/M' }
  BE -> X: POST /2/chat/media/upload/:session_id/append\n{ media: base64_chunk, media_hash_key, segment_index }
  X --> BE: OK
end

BE --> UI: SSE: { step: 'finalize' }
BE -> X: POST /2/chat/media/upload/:session_id/finalize\n{ media_hash_key, num_parts }
X --> BE: { success: true }
BE --> UI: SSE: { step: 'complete', media_hash_key }

User -> UI: Send message with media_hash_key
@enduml
```

### Media Download / Proxy Flow

```plantuml
@startuml
title X Chat Media Download

participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xchat-handlers)" as BE
database "Media Cache\n(file-cache)" as Cache
participant "X Servers\n(ton.x.com)" as X

UI -> BE: GET /xchat/media/proxy\n?conversation_id=...&media_hash_key=...
BE -> Cache: get("xchat:{conv_id}:{hash_key}")
alt cache hit
  Cache --> BE: { buffer, contentType }
  BE --> UI: binary media bytes
else cache miss
  BE -> X: GET /2/chat/media/:id/:media_hash_key
  X --> BE: encrypted media bytes
  BE -> Cache: set(key, buffer, contentType)
  BE --> UI: binary media bytes
end
@enduml
```

### XAA Subscription + Webhook Event Flow

```plantuml
@startuml
title XAA Subscription & Chat Event Delivery

actor User
participant "X Chat UI\n(xchat.js)" as UI
participant "Backend\n(xaa-handlers)" as XAA
participant "Backend\n(webhook-handlers)" as WH
participant "X Servers" as X
participant "Browser\n(app.js)" as Browser

== Setup ==
User -> UI: Open XAA tab, fill form\n(event_type, user_id, webhook_id)
UI -> XAA: POST /xaa/subscriptions?auth=oauth2\n{ event_type: "chat.received",\n  user_id, webhook_id }
XAA -> X: POST /2/activity/subscriptions\n(authenticated with user OAuth2 token)
X --> XAA: { subscription_id, ... }
XAA --> UI: subscription created

== Event Delivery ==
X -> WH: POST /webhook/:appId\n(chat.received event, HMAC-SHA256 signed)
WH -> WH: Verify signature\nLog to data/webhooks/\nBroadcast via webhookEventBus
WH --> X: 200 OK

WH -> Browser: SSE /webhook-events/stream\n{ event_type: "chat.received",\n  filter: { user_id },\n  payload: [encrypted] }
Browser -> Browser: classifyEvent() → 'xchat'\ngetEventIcon() → '🔐'\ngetEventSummary() → event_type +\nuser_id + "[encrypted payload]"
Browser -> User: 🔐 chat.received [encrypted payload]\nin 📨 Events modal
@enduml
```

---

## Task Status

| Task | Description | Status |
|------|-------------|--------|
| 1 | Extract shared handler utilities (`handler-utils.ts`) | ✅ Done |
| 2 | X Chat backend handlers (`xchat-handlers.ts`) | ✅ Done |
| 3 | Register new routes in `oauth-demo.ts` | ✅ Done |
| 4 | Frontend chat mode selection (`app.js`) | ✅ Done |
| 5 | X Chat UI (`xchat.js`, `index.html`, `style.css`) | ✅ Done |
| 6 | Media attachment flow (upload + download) | ✅ Done |
| 7 | XAA backend handlers (`xaa-handlers.ts`) | ✅ Done |
| 8 | XAA frontend (subscription management + event display) | ✅ Done |
| — | PIN management + key caching on integration | ✅ Done |
