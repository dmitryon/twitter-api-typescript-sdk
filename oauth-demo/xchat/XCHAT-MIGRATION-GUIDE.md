# XChat Enterprise User Migration Guide v1

> **NOTE:** This product is currently in a beta state. While we don't anticipate any major changes to the release version, please bear with us as we smooth out rough edges. Please don't hesitate to reach out if something doesn't look right.

**Date Created:** February 11, 2026  
**Authors:** The X Developer API Team

---

## Table of Contents

- [Background / Rationale](#background--rationale)
  - [The Key Change](#the-key-change)
- [New Routes](#new-routes)
- [The XDKs](#the-xdks)
- [Request / Response Guide](#request--response-guide)
  - [Getting User Messages](#getting-user-messages)
  - [Sending User Messages](#sending-user-messages)
  - [Sending Media Attachments](#sending-media-attachments)
- [Streaming / Automated Replies Guide](#streaming--automated-replies-guide)
  - [The X Activity API](#the-x-activity-api)
  - [Creating a Reply Bot](#creating-a-reply-bot)
- [Important Information](#important-information)
  - [Conversation IDs and Groupchats](#conversation-ids-and-groupchats)

---

## Encryption Stack

Deduced from the xchat-bot-python and xchat-bot-go reference implementations, the OpenAPI spec, and the chat-xdk API surface.

### Key Types

| Key | Algorithm | Purpose |
|-----|-----------|--------|
| `public_key` / private key | X25519 (Curve25519) | Key agreement — wrapping/unwrapping conversation keys |
| `signing_public_key` / signing private key | Ed25519 | Message signing / verification |

Both key pairs are stored in **Juicebox** — a distributed PIN-based threshold secret sharing system. The user's 4-digit PIN unlocks the private keys from Juicebox realms.

### Conversation Key

A 32-byte AES-256 symmetric key, unique per conversation and versioned (`conversation_key_version`). Wrapped per-participant using their X25519 public key via ECIES:

```
X25519 ephemeral key exchange → HKDF → AES-GCM → encrypted_conversation_key (base64)
```

The `encrypted_conversation_key` arrives in each event payload. The chat-xdk decrypts it using the recipient's X25519 private key.

### Message Encryption

```
plaintext
  → Apache Thrift MessageCreateEvent struct (binary serialization)
  → AES-256-GCM encrypt with conversation key
  → base64
  = encoded_message_create_event
```

### Message Signing

```
message event
  → Apache Thrift MessageEventSignature struct
  → Ed25519 sign with signing private key
  → base64
  = encoded_message_event_signature
```

### KeyChange Events

When a conversation key rotates, a `conversation_key_change_event` is included in the payload instead of `encrypted_conversation_key`. KeyChange events are decryptable with an empty key. The chat-xdk's `decrypt_event(event, "")` handles this — iterate `participant_keys` and try each `encrypted_key` until one decrypts successfully.

### Juicebox Key Recovery

The `juicebox_config` from `GET /2/users/{id}/public_keys` contains:
- `key_store_token_map_json` — SDK configuration
- `token_map` — per-realm JWT auth tokens
- `max_guess_count` — PIN attempt limit

The chat-xdk normalises this into `{ sdk_config, tokens, max_guess_count }` and calls `chat.unlock(pin, juiceboxConfig)` to retrieve the private keys.

### Wire Format Note

Apache Thrift is used purely as the **serialization format** for message structs before encryption — not the encryption mechanism itself. The `.thrift` schema for `MessageCreateEvent` is internal to the chat-xdk.

---

## Background / Rationale

The X Platform has rewritten its Direct Messaging stack from the bottom up, shifting to a fully end-to-end encrypted model.

While this offers many benefits to users, there is an additional layer that our Enterprise users will need to adhere to in order to utilize this new stack for their customers.

This guide aims to make the transition (or new adoption) as easy as possible.

### The Key Change

The largest change is that the message stack is fully e2e encrypted. This means when you request messages, attachments, media, etc. for an authorized user, your app will receive an encrypted payload.

This requires the client application to perform decryption.

The same applies to sending messages. The client application will need to perform the encryption step and send the encrypted payload to the API.

We've developed custom X SDKs (or XDKs) that perform all of this functionality for you.

However, you **will** need to store the numeric PINs for your users in a secure fashion. These PINs are used to retrieve the private keys of the user, which in turn are used to encrypt/decrypt their messages.

---

## New Routes

| Method | Route | Auth | Description | Docs |
|--------|-------|------|-------------|------|
| GET | `/2/users/{id}/public_keys` | User OAuth | Returns the public keys and Juicebox configuration for the specified user | https://docs.x.com/x-api/chat/get-user-public-keys |
| GET | `/2/chat/conversations` | User OAuth | Retrieves a list of Chat conversations for the authenticated user's inbox | https://docs.x.com/x-api/chat/get-chat-conversations |
| GET | `/2/chat/conversations/{conversation_id}` | User OAuth | Retrieves messages and key change events for a specific Chat conversation with pagination support | https://docs.x.com/x-api/chat/get-chat-conversation |
| POST | `/2/chat/conversations/{conversation_id}/messages` | User OAuth | Send an encrypted message on behalf of a user to a specific chat conversation | https://docs.x.com/x-api/chat/send-chat-message |
| POST | `/2/chat/media/upload/initialize` | User OAuth | Initialize a media upload session for a chat media attachment. Returns a `session_id` and a `media_hash_key` | NOT YET IN PROD. COMING SOON. |
| POST | `/2/chat/media/upload/{session_id}/append` | User OAuth | Append media data (base64-encoded) to an in-progress upload session | NOT YET IN PROD. COMING SOON. |
| POST | `/2/chat/media/upload/{session_id}/finalize` | User OAuth | Finalize a media upload session, making the media available for use in a chat message | NOT YET IN PROD. COMING SOON. |

### Legacy DM Routes

These routes do **not** support XChat messages. They can still be used to receive legacy DMs if your customers have not upgraded, but encrypted messages cannot be received or sent through these routes:

- Any routes pertaining to `/2/dm_events/...`
- Account activity routes: `/2/account_activity/...`

---

## The XDKs

X offers XDKs to make interacting with our API easier, including handling the encryption/decryption logic for chat.

Our general XDK for handling auth, sending requests, opening streams, registering webhooks, etc. are supported in Python and TypeScript:

| Language | Package | Repo |
|----------|---------|------|
| Python | `pip install xdk` | xdk-python |
| TypeScript | `npm install @xdevplatform/xdk` | xdk-typescript |

We have a separate XDK for handling chat encryption/decryption. You can find it here:

| Language | Package | Repo |
|----------|---------|------|
| Rust w/ Python Bindings | Still in security review for release. You will have to clone the repo and build from source in its current state. Build instructions are included in the README | chat-xdk |

For a complete working example of a bot that uses the chat-xdk with the X Activity API to handle automated replies, see the reference implementation: **xchat-bot-python**

---

## Request / Response Guide

This section details how to interact with the request/response routes to interact with the XChat API.

### Login / User Auth

For all routes, you will be required to provide OAuth2 access tokens from your users.

Check out our docs for a reference: [OAuth 2.0 Flow with PKCE]

---

### Getting User Messages

```plantuml
@startuml
title Flow for retrieving user messages

participant User
participant "Client App" as App
participant "X Servers" as X

User -> App: a. User OAuth2 Authentication Flow
User -> App: User provides Chat PIN
App -> App: PIN stored securely

note over App, X: b. Request public keys
App -> X: GET /2/users/{id}/public_keys
X --> App: Public Keys for user

note over App, X: c. Retrieve private key from Juicebox
App -> X: Request private keys from Juicebox\nw/ public_keys and PIN for user
X --> App: Private Keys for user
App -> App: You can store keys for user,\nor request them for each message tx/rx

User -> App: Get Messages Request
App -> X: GET /2/chat/conversations
X --> App: List of Chat conversations for user

note over App, X: d. Fetch and decrypt messages
App -> X: GET /2/chat/conversations/{id}
X --> App: List of encrypted messages in a conversation
App -> App: Decrypt using XDK with private key
App --> User: List of decrypted messages
@enduml
```

**Steps:**

- **a.** User OAuth2 flow
- **b.** Your client app needs to request the user's XChat PIN. This is the numeric 4-digit PIN they set up when using the Chat feature within the X app (shown as "Change Passcode" — *"This passcode should be memorable and kept private. Without it, you will not be able to access your messages."*)
- **c.** Getting user keys is a 2-step process. First, use the GET route to retrieve the user's public keys. Then, use the XDK in conjunction with the user's public key and PIN to retrieve the user's private key from the secure Juicebox key store.
  - **NOTE:** If you decide to store the user's private key, you should do so in a secure manner. Treat it like a password or their PIN.
- **d.** Your app is now able to use the XDK to decrypt the user's encrypted messages. Retrieve their conversations, and then retrieve messages for specific conversation ids. The decrypted payloads can then be displayed to your users.

---

### Sending User Messages

```plantuml
@startuml
title Flow for sending user messages

participant User
participant "Client App" as App
participant "X Servers" as X

User -> App: User OAuth2 Authentication Flow
User -> App: User provides Chat PIN
App -> App: PIN stored securely

App -> X: GET /2/users/{id}/public_keys
X --> App: Public Keys for user

App -> X: Request private keys from Juicebox\nw/ public_keys and PIN for user
X --> App: Private Keys for user
App -> App: You can store keys for user,\nor request them for each message tx/rx

User -> App: Send Message request with plaintext
note over App
  Encrypt and sign message using XDK w/ private key
end note
App -> X: POST /2/chat/conversations/{id}/messages\n{ encoded_message_create_event, message_id }
X --> App: Success
App --> User: Success
@enduml
```

The flow for sending messages on behalf of your users is roughly the same, just reversed.

The user will send their message to your app, your app will encrypt using the XDK with their private key, and then use the POST endpoint to send.

This exact flow will be used if the user is manually requesting to send messages via your app. See the streaming section for automated replies.

---

### Sending Media Attachments

Chat messages can include media attachments such as images. Sending media follows a 3-step upload flow before the message itself is sent:

1. **Initialize** — `POST /2/chat/media/upload/initialize` with the total byte size of the media. The response includes a `session_id` and a `media_hash_key`.
2. **Append** — `POST /2/chat/media/upload/{session_id}/append` with the base64-encoded media bytes along with the `media_hash_key` returned from the initialize step.
3. **Finalize** — `POST /2/chat/media/upload/{session_id}/finalize` with the `media_hash_key`. Once finalized, the media is ready to be referenced in a chat message.

After the upload is finalized, you'll use the `media_hash_key` to construct an encrypted message with a media attachment via `chat.encrypt_message_with_media_for_api()` in the chat-xdk. This method builds the encrypted payload with the attachment metadata (hash key, dimensions, filename, etc.), which you then send via the existing `POST /2/chat/conversations/{conversation_id}/messages` endpoint.

**Receiving media** works in reverse: when a decrypted message contains media attachments, you can extract the `media_hash_key` from the attachment metadata and fetch the encrypted media bytes from:

```
https://ton.x.com/1.1/ton/data/xchat_media/{conversation_id}/{media_hash_key}
```

The chat-xdk provides helpers to decrypt the fetched media bytes.

---

## Streaming / Automated Replies Guide

This section will cover how to get messages in real-time and send automatic replies. Great for customer service or reply bots.

### The X Activity API

To receive chat messages in real-time on behalf of your users, you'll need to use our new real-time activity subscription suite called the X Activity API (or XAA).

XAA works with a subscription/filter model. You'll subscribe to an event type — in this case `chat.received` for messages your users receive and `chat.sent` if you'd like events when your users send messages — and apply a filter.

Filters can generally take on different forms, but `chat` subscriptions can only be filtered by user id. So for each user you are interested in getting real-time events for, you'll create a separate subscription using each user ID as a filter.

For example, to get a real-time event whenever user `123` receives a chat message:

```
POST /2/activity/subscriptions -d '{"event_type": "chat.received",
"filter": {"user_id": "123"}, "tag": "user 123 chat events"}'
```

The `tag` field is optional, but may be useful for internal bookkeeping.

You'll use user `123`'s OAuth2 token to authenticate to this endpoint.

You can then open a stream, which is a persistent HTTP connection:

```
GET /2/activity/stream
```

This stream will stay open as long as you keep it open, but we recommend implementing some robust retry logic for reliability.

If you'd prefer, the X Activity API also supports webhook delivery. When creating the `chat.received` subscription, you'll simply pass in your `webhook_id` and it will deliver events automatically.

---

### Creating a Reply Bot

To create the chat bot, you'll create an app that consumes from the activity stream (or webhook), and then set up reply logic when an event is received, using the appropriate users' keys.

For a complete working example, see the reference implementation: **xchat-bot-python**

```plantuml
@startuml
title A sample flow for reply bot

participant User
participant "Client App" as App
participant "X Servers" as X

note over App, X: a. Open stream or register webhook
App -> X: GET /2/activity/stream or register webhook
X --> App: Live activity stream

User -> App: b. User OAuth2 Authentication Flow
User -> App: User provides Chat PIN
App -> App: PIN stored securely

App -> X: GET /2/users/{id}/public_keys
X --> App: Public Keys for user

note over App, X: c. Retrieve and optionally store private key
App -> X: Request private keys from Juicebox\nw/ public_keys and PIN for user
X --> App: Private Keys for user
App -> App: Private key stored securely

note over App, X: d. Create activity subscription
App -> X: POST /2/activity/subscriptions
X --> App: Success

note over App, X: e. Event loop
X -> App: chat.received event with encrypted message\nsent through activity stream or webhook
App -> App: 1. Decrypt message with XDK using private key\n2. Process message and formulate response\n3. Encrypt response with XDK
App -> X: POST /2/chat/conversations/{id}/messages
X --> App: Success
@enduml
```

**Steps:**

- **a.** Your client app either opens the activity stream or registers a webhook. You'll be able to add/remove user subscriptions while the stream is open without refreshing.
- **b.** Normal OAuth2 user login flow, and PIN request, as covered in previous sections. If the user ever changes their PIN, they'll have to repeat this step.
- **c.** Request the user's public key, and use the PIN to request the private key. In this sample flow, we incorporate key storage. Alternatively, you can unlock the private key for each message event, and then won't have to store, but design is up to you.
- **d.** Create the user's activity subscription for `chat.received` messages. When this user receives a message now, it will come through your stream or webhook that you set up in step a. If you're using a webhook, you'll provide the `webhook_id` when creating the subscription.
- **e.** This is the event loop. When an event arrives through your stream or webhook, you'll decrypt using the appropriate user's key. You'll then perform any message processing with the decrypted message. You'll then encrypt the response and send, just as we did in the previous section.

---

## Important Information

### Conversation IDs and Groupchats

For reply bots in particular, it may be helpful to distinguish whether you are replying to a message from a direct user, or from a groupchat.

For example, you'll want to reply to any messages received in a one-on-one conversation between a customer and your reply bot, but in groupchats you may only want to reply when the bot is tagged (i.e. `@bot_username`).

To make this distinction, you can use the conversation id:

- **1:1 conversations** — the conversation id is simply the two user ids separated by a dash. For example: `123456789-987654321` is a conversation between user `123456789` and user `987654321`.
- **Groupchats** — have their own unique ids, prefixed by `g`. For example: `g123456789`. The ID does not contain any other relevant information in terms of recipients, but the `g` prefix can be used to tell quickly if the message is coming from a groupchat or not.
