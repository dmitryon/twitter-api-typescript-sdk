/**
 * thrift-models.ts — Auto-generated from Go struct definitions
 * Source: pkg/twittermeow/data/payload/thrift.go
 */

import { type Schema, T } from "./thrift-codec";

export const SendMessageEventResponseSchema: Schema = [
  { id: 1, name: "messageEvent", type: T.STRING },
  { id: 2, name: "messageInstruction", type: T.STRING },
  { id: 3, name: "batchedMessageEvents", type: T.STRING },
];

export const UrlRichTextContentSchema: Schema = [];
export const UpdatePathNodeSchema: Schema = [
  { id: 1, name: "encrypted_secrets", type: T.LIST, elemType: T.STRING },
  { id: 2, name: "encrypted_private_key", type: T.STRING },
];

export const UnpinConversationSchema: Schema = [
  { id: 1, name: "conversation_id", type: T.STRING },
];

export const UnmuteConversationSchema: Schema = [
  { id: 1, name: "unmuted_conversation_ids", type: T.LIST, elemType: T.STRING },
];

export const UnifiedCardAttachmentSchema: Schema = [
  { id: 1, name: "url", type: T.STRING },
  { id: 2, name: "attachment_id", type: T.STRING },
];

export const SwitchToHybridPullInstructionSchema: Schema = [
  { id: 1, name: "requesting_user_agent", type: T.STRING },
];

export const StoredKeypairSchema: Schema = [
  { id: 1, name: "public_key", type: T.STRING },
  { id: 2, name: "private_key", type: T.STRING },
];

export const SetVerifiedStatusSchema: Schema = [
  { id: 1, name: "user_id", type: T.I64, asNumber: true },
  { id: 2, name: "verified_status", type: T.BOOL },
];

export const ScreenCaptureDetectedSchema: Schema = [
  { id: 1, name: "type", type: T.I32 },
];

export const RequestForEncryptedResendEventSchema: Schema = [
  { id: 1, name: "min_sequence_id", type: T.STRING },
  { id: 2, name: "max_sequence_id", type: T.STRING },
];

export const QuickReplyOptionsResponseSchema: Schema = [
  { id: 1, name: "request_id", type: T.STRING },
  { id: 2, name: "metadata", type: T.STRING },
  { id: 3, name: "selected_option_id", type: T.STRING },
];

export const QuickReplyOptionSchema: Schema = [
  { id: 1, name: "id", type: T.STRING },
  { id: 2, name: "label", type: T.STRING },
  { id: 3, name: "metadata", type: T.STRING },
  { id: 4, name: "description", type: T.STRING },
];

export const PullMessagesInstructionSchema: Schema = [
  { id: 1, name: "sequence_start", type: T.STRING },
  { id: 2, name: "sender_id", type: T.STRING },
  { id: 6, name: "is_batched_pull", type: T.BOOL },
];

export const PullMessagePageDetailsSchema: Schema = [
  { id: 3, name: "min_sequence_id", type: T.STRING },
  { id: 4, name: "max_sequence_id", type: T.STRING },
  { id: 7, name: "is_batched_pull", type: T.BOOL },
];

export const PostAttachmentSchema: Schema = [
  { id: 1, name: "rest_id", type: T.STRING },
  { id: 2, name: "post_url", type: T.STRING },
  { id: 3, name: "attachment_id", type: T.STRING },
];

export const PinReminderInstructionSchema: Schema = [
  { id: 1, name: "should_register", type: T.BOOL },
  { id: 2, name: "should_generate", type: T.BOOL },
];

export const PinConversationSchema: Schema = [
  { id: 1, name: "conversation_id", type: T.STRING },
];

export const PhoneNumberRichTextContentSchema: Schema = [];
export const ParentNodeSchema: Schema = [
  { id: 1, name: "subtree_encryption_public_key", type: T.STRING },
  { id: 2, name: "parent_hash", type: T.STRING },
];

export const NicknameMessageSchema: Schema = [
  { id: 1, name: "user_id", type: T.I64, asNumber: true },
  { id: 2, name: "nickname_text", type: T.STRING },
];

export const MuteConversationSchema: Schema = [
  { id: 1, name: "muted_conversation_ids", type: T.LIST, elemType: T.STRING },
];

export const MoneyAttachmentSchema: Schema = [
  { id: 1, name: "fallbackText", type: T.STRING },
  { id: 2, name: "payload", type: T.STRING },
];

export const MessageTypingEventSchema: Schema = [
  { id: 1, name: "conversation_id", type: T.STRING },
];

export const MessageReactionRemoveSchema: Schema = [
  { id: 1, name: "message_sequence_id", type: T.STRING },
  { id: 2, name: "emoji", type: T.STRING },
];

export const MessageReactionAddSchema: Schema = [
  { id: 1, name: "message_sequence_id", type: T.STRING },
  { id: 2, name: "emoji", type: T.STRING },
];

export const MessageFailureEventSchema: Schema = [
  { id: 1, name: "failure_type", type: T.I32 },
];

export const MessageEventSignatureSchema: Schema = [
  { id: 1, name: "signature", type: T.STRING },
  { id: 2, name: "public_key_version", type: T.STRING },
  { id: 3, name: "signature_version", type: T.STRING },
  { id: 4, name: "signing_public_key", type: T.STRING },
];

export const MessageEventRelaySourceSchema: Schema = [];
export const MessageDurationRemoveSchema: Schema = [
  { id: 1, name: "current_ttl_msec", type: T.I64, asNumber: true },
];

export const MessageDurationChangeSchema: Schema = [
  { id: 1, name: "ttl_msec", type: T.I64, asNumber: true },
];

export const MessageDeleteEventSchema: Schema = [
  { id: 1, name: "sequence_ids", type: T.LIST, elemType: T.STRING },
  { id: 2, name: "delete_message_action", type: T.I32 },
];

export const MessageCreateEventSchema: Schema = [
  { id: 100, name: "contents", type: T.STRING, binary: true },
  { id: 101, name: "conversation_key_version", type: T.STRING },
  { id: 102, name: "should_notify", type: T.BOOL },
  { id: 103, name: "ttl_msec", type: T.I64, asNumber: true },
  { id: 104, name: "delivered_at_msec", type: T.I64, asNumber: true },
  { id: 105, name: "is_pending_public_key", type: T.BOOL },
  { id: 106, name: "priority", type: T.I32 },
  { id: 107, name: "additional_action_list", type: T.LIST, elemType: T.I32 },
];

export const MentionRichTextContentSchema: Schema = [];
export const MemberAccountDeleteEventSchema: Schema = [
  { id: 1, name: "member_id", type: T.STRING },
];

export const MediaDimensionsSchema: Schema = [
  { id: 1, name: "width", type: T.I64, asNumber: true },
  { id: 2, name: "height", type: T.I64, asNumber: true },
];

export const MediaAttachmentSchema: Schema = [
  { id: 1, name: "media_hash_key", type: T.STRING },
  { id: 2, name: "dimensions", type: T.STRUCT, schema: MediaDimensionsSchema },
  { id: 3, name: "type", type: T.I32 },
  { id: 4, name: "duration_millis", type: T.I64, asNumber: true },
  { id: 5, name: "filesize_bytes", type: T.I64, asNumber: true },
  { id: 6, name: "filename", type: T.STRING },
  { id: 7, name: "attachment_id", type: T.STRING },
  { id: 8, name: "legacy_media_url_https", type: T.STRING },
  { id: 9, name: "legacy_media_preview_url", type: T.STRING },
];

export const MaybeKeypairSchema: Schema = [
  { id: 1, name: "empty", type: T.STRING },
  { id: 2, name: "keypair", type: T.STRUCT, schema: StoredKeypairSchema },
];

export const MarkConversationUnreadEventSchema: Schema = [
  { id: 1, name: "seen_until_sequence_id", type: T.STRING },
];

export const MarkConversationUnreadSchema: Schema = [
  { id: 1, name: "seen_until_sequence_id", type: T.STRING },
];

export const MarkConversationReadEventSchema: Schema = [
  { id: 1, name: "seen_until_sequence_id", type: T.STRING },
  { id: 2, name: "seen_at_millis", type: T.I64, asNumber: true },
];

export const MarkConversationReadSchema: Schema = [
  { id: 1, name: "seen_until_sequence_id", type: T.STRING },
  { id: 2, name: "seen_at_millis", type: T.I64, asNumber: true },
];

export const LeafNodeSchema: Schema = [
  { id: 1, name: "subtree_encryption_public_key", type: T.STRING },
  { id: 2, name: "signature_public_key", type: T.STRING },
  { id: 3, name: "keypair_id", type: T.STRING },
  { id: 4, name: "max_supported_protocol_version", type: T.I32 },
  { id: 5, name: "parent_hash", type: T.STRING },
  { id: 6, name: "signature", type: T.STRING },
];

export const KeepAliveInstructionSchema: Schema = [];
export const HashtagRichTextContentSchema: Schema = [];
export const GroupTitleChangeSchema: Schema = [
  { id: 1, name: "custom_title", type: T.STRING },
  { id: 2, name: "conversation_key_version", type: T.STRING },
];

export const GroupMemberRemoveChangeSchema: Schema = [
  { id: 1, name: "member_ids", type: T.LIST, elemType: T.STRING },
];

export const GroupMemberAddChangeSchema: Schema = [
  { id: 1, name: "member_ids", type: T.LIST, elemType: T.STRING },
  { id: 2, name: "current_member_ids", type: T.LIST, elemType: T.STRING },
  { id: 3, name: "current_admin_ids", type: T.LIST, elemType: T.STRING },
  { id: 4, name: "current_title", type: T.STRING },
  { id: 5, name: "current_avatar_url", type: T.STRING },
  { id: 6, name: "conversation_key_version", type: T.STRING },
  { id: 7, name: "current_ttl_msec", type: T.I64, asNumber: true },
  { id: 8, name: "current_pending_member_ids", type: T.LIST, elemType: T.STRING },
];

export const GroupJoinRequestSchema: Schema = [
  { id: 1, name: "requesting_user_id", type: T.STRING },
];

export const GroupJoinRejectSchema: Schema = [
  { id: 1, name: "rejected_user_ids", type: T.LIST, elemType: T.STRING },
];

export const GroupInviteEnableSchema: Schema = [
  { id: 1, name: "expires_at_msec", type: T.I64, asNumber: true },
  { id: 2, name: "invite_url", type: T.STRING },
  { id: 3, name: "affiliate_id", type: T.STRING },
];

export const GroupInviteDisableSchema: Schema = [
  { id: 1, name: "disabled_by_member_id", type: T.STRING },
];

export const GroupCreateSchema: Schema = [
  { id: 1, name: "member_ids", type: T.LIST, elemType: T.STRING },
  { id: 2, name: "admin_ids", type: T.LIST, elemType: T.STRING },
  { id: 3, name: "title", type: T.STRING },
  { id: 4, name: "avatar_url", type: T.STRING },
  { id: 5, name: "conversation_key_version", type: T.STRING },
];

export const GroupAvatarUrlChangeSchema: Schema = [
  { id: 1, name: "custom_avatar_url", type: T.STRING },
  { id: 2, name: "conversation_key_version", type: T.STRING },
];

export const GroupAdminRemoveChangeSchema: Schema = [
  { id: 1, name: "admin_ids", type: T.LIST, elemType: T.STRING },
];

export const GroupAdminAddChangeSchema: Schema = [
  { id: 1, name: "admin_ids", type: T.LIST, elemType: T.STRING },
];

export const GrokSearchResponseEventSchema: Schema = [
  { id: 1, name: "search_response_id", type: T.STRING },
];

export const EventQueuePrioritySchema: Schema = [];
export const EnableScreenCaptureDetectionSchema: Schema = [
  { id: 1, name: "placeholder", type: T.STRING },
];

export const EnableScreenCaptureBlockingSchema: Schema = [
  { id: 1, name: "placeholder", type: T.STRING },
];

export const EmptyNodeSchema: Schema = [
  { id: 1, name: "description", type: T.STRING },
];

export const EmailRichTextContentSchema: Schema = [];
export const DraftMessageSchema: Schema = [
  { id: 1, name: "conversation_id", type: T.STRING },
  { id: 2, name: "draft_text", type: T.STRING },
];

export const DisplayTemporaryPasscodeInstructionSchema: Schema = [
  { id: 1, name: "token", type: T.STRING },
  { id: 2, name: "latest_public_key_version", type: T.STRING },
];

export const DisableScreenCaptureDetectionSchema: Schema = [
  { id: 1, name: "placeholder", type: T.STRING },
];

export const DisableScreenCaptureBlockingSchema: Schema = [
  { id: 1, name: "placeholder", type: T.STRING },
];

export const ConversationParticipantKeySchema: Schema = [
  { id: 1, name: "user_id", type: T.STRING },
  { id: 2, name: "encrypted_conversation_key", type: T.STRING },
  { id: 3, name: "public_key_version", type: T.STRING },
];

export const ConversationMetadataChangeSchema: Schema = [
  { id: 1, name: "message_duration_change", type: T.STRUCT, schema: MessageDurationChangeSchema },
  { id: 2, name: "message_duration_remove", type: T.STRUCT, schema: MessageDurationRemoveSchema },
  { id: 3, name: "mute_conversation", type: T.STRUCT, schema: MuteConversationSchema },
  { id: 4, name: "unmute_conversation", type: T.STRUCT, schema: UnmuteConversationSchema },
  { id: 5, name: "enable_screen_capture_detection", type: T.STRUCT, schema: EnableScreenCaptureDetectionSchema },
  { id: 6, name: "disable_screen_capture_detection", type: T.STRUCT, schema: DisableScreenCaptureDetectionSchema },
  { id: 7, name: "enable_screen_capture_blocking", type: T.STRUCT, schema: EnableScreenCaptureBlockingSchema },
  { id: 8, name: "disable_screen_capture_blocking", type: T.STRUCT, schema: DisableScreenCaptureBlockingSchema },
];

export const ConversationDeleteEventSchema: Schema = [
  { id: 1, name: "conversation_id", type: T.STRING },
];

export const CashtagRichTextContentSchema: Schema = [];
export const CallToActionSchema: Schema = [
  { id: 1, name: "label", type: T.STRING },
  { id: 2, name: "url", type: T.STRING },
];

export const AddressRichTextContentSchema: Schema = [];
export const AcceptMessageRequestSchema: Schema = [];
export const AVCallStartedSchema: Schema = [
  { id: 1, name: "is_audio_only", type: T.BOOL },
  { id: 3, name: "broadcast_id", type: T.STRING },
];

export const AVCallMissedSchema: Schema = [
  { id: 1, name: "sent_at_millis", type: T.I64, asNumber: true },
  { id: 2, name: "is_audio_only", type: T.BOOL },
];

export const AVCallEndedSchema: Schema = [
  { id: 1, name: "sent_at_millis", type: T.I64, asNumber: true },
  { id: 2, name: "duration_seconds", type: T.I64, asNumber: true },
  { id: 3, name: "is_audio_only", type: T.BOOL },
  { id: 5, name: "broadcast_id", type: T.STRING },
];

export const UrlAttachmentImageSchema: Schema = [
  { id: 1, name: "media_hash_key", type: T.STRING },
  { id: 2, name: "filesize_bytes", type: T.I64, asNumber: true },
  { id: 3, name: "filename", type: T.STRING },
  { id: 4, name: "dimensions", type: T.STRUCT, schema: MediaDimensionsSchema },
];

export const UrlAttachmentSchema: Schema = [
  { id: 1, name: "url", type: T.STRING },
  { id: 2, name: "banner_image_media_hash_key", type: T.STRUCT, schema: UrlAttachmentImageSchema },
  { id: 3, name: "favicon_image_media_hash_key", type: T.STRUCT, schema: UrlAttachmentImageSchema },
  { id: 4, name: "display_title", type: T.STRING },
  { id: 5, name: "attachment_id", type: T.STRING },
];

export const RichTextContentSchema: Schema = [
  { id: 1, name: "hashtag", type: T.STRUCT, schema: HashtagRichTextContentSchema },
  { id: 2, name: "cashtag", type: T.STRUCT, schema: CashtagRichTextContentSchema },
  { id: 3, name: "mention", type: T.STRUCT, schema: MentionRichTextContentSchema },
  { id: 4, name: "url", type: T.STRUCT, schema: UrlRichTextContentSchema },
  { id: 5, name: "email", type: T.STRUCT, schema: EmailRichTextContentSchema },
  { id: 7, name: "phoneNumber", type: T.STRUCT, schema: PhoneNumberRichTextContentSchema },
];

export const RatchetTreeParentSchema: Schema = [
  { id: 1, name: "empty", type: T.STRUCT, schema: EmptyNodeSchema },
  { id: 2, name: "parent", type: T.STRUCT, schema: ParentNodeSchema },
];

export const RatchetTreeLeafSchema: Schema = [
  { id: 1, name: "empty", type: T.STRUCT, schema: EmptyNodeSchema },
  { id: 2, name: "leaf", type: T.STRUCT, schema: LeafNodeSchema },
];

export const RatchetTreeSchema: Schema = [
  { id: 1, name: "leaves", type: T.LIST, elemType: T.STRUCT, elemSchema: RatchetTreeLeafSchema },
  { id: 2, name: "parents", type: T.LIST, elemType: T.STRUCT, elemSchema: RatchetTreeParentSchema },
];

export const QuickReplyResponseSchema: Schema = [
  { id: 1, name: "options", type: T.STRUCT, schema: QuickReplyOptionsResponseSchema },
];

export const QuickReplyOptionsRequestSchema: Schema = [
  { id: 1, name: "id", type: T.STRING },
  { id: 2, name: "options", type: T.LIST, elemType: T.STRUCT, elemSchema: QuickReplyOptionSchema },
];

export const PullMessagesFinishedInstructionSchema: Schema = [
  { id: 1, name: "finished_pull", type: T.BOOL },
  { id: 2, name: "sequence_continue", type: T.STRING },
  { id: 3, name: "pull_message_page_details", type: T.STRUCT, schema: PullMessagePageDetailsSchema },
];

export const MessageInstructionSchema: Schema = [
  { id: 1, name: "pullMessagesInstruction", type: T.STRUCT, schema: PullMessagesInstructionSchema },
  { id: 2, name: "keepAliveInstruction", type: T.STRUCT, schema: KeepAliveInstructionSchema },
  { id: 3, name: "pullMessagesFinishedInstruction", type: T.STRUCT, schema: PullMessagesFinishedInstructionSchema },
  { id: 4, name: "pinReminderInstruction", type: T.STRUCT, schema: PinReminderInstructionSchema },
  { id: 5, name: "switchToHybridPullInstruction", type: T.STRUCT, schema: SwitchToHybridPullInstructionSchema },
  { id: 6, name: "displayTemporaryPasscodeInstruction", type: T.STRUCT, schema: DisplayTemporaryPasscodeInstructionSchema },
];

export const MessageAttachmentSchema: Schema = [
  { id: 1, name: "media", type: T.STRUCT, schema: MediaAttachmentSchema },
  { id: 2, name: "post", type: T.STRUCT, schema: PostAttachmentSchema },
  { id: 3, name: "url", type: T.STRUCT, schema: UrlAttachmentSchema },
  { id: 4, name: "unified_card", type: T.STRUCT, schema: UnifiedCardAttachmentSchema },
  { id: 5, name: "money", type: T.STRUCT, schema: MoneyAttachmentSchema },
];

export const KeyRotationSchema: Schema = [
  { id: 1, name: "previous_version", type: T.STRING },
  { id: 2, name: "ratchet_tree", type: T.STRUCT, schema: RatchetTreeSchema },
  { id: 3, name: "nodes", type: T.LIST, elemType: T.STRUCT, elemSchema: UpdatePathNodeSchema },
  { id: 4, name: "encrypted_private_key", type: T.STRING },
];

export const GroupChangeSchema: Schema = [
  { id: 1, name: "group_create", type: T.STRUCT, schema: GroupCreateSchema },
  { id: 2, name: "group_title_change", type: T.STRUCT, schema: GroupTitleChangeSchema },
  { id: 3, name: "group_avatar_change", type: T.STRUCT, schema: GroupAvatarUrlChangeSchema },
  { id: 4, name: "group_admin_add", type: T.STRUCT, schema: GroupAdminAddChangeSchema },
  { id: 5, name: "group_member_add", type: T.STRUCT, schema: GroupMemberAddChangeSchema },
  { id: 6, name: "group_admin_remove", type: T.STRUCT, schema: GroupAdminRemoveChangeSchema },
  { id: 7, name: "group_member_remove", type: T.STRUCT, schema: GroupMemberRemoveChangeSchema },
  { id: 8, name: "group_invite_enable", type: T.STRUCT, schema: GroupInviteEnableSchema },
  { id: 9, name: "group_invite_disable", type: T.STRUCT, schema: GroupInviteDisableSchema },
  { id: 10, name: "group_join_request", type: T.STRUCT, schema: GroupJoinRequestSchema },
  { id: 11, name: "group_join_reject", type: T.STRUCT, schema: GroupJoinRejectSchema },
];

export const ConversationMetadataChangeEventSchema: Schema = [
  { id: 1, name: "conversation_metadata_change", type: T.STRUCT, schema: ConversationMetadataChangeSchema },
];

export const ConversationKeyChangeEventSchema: Schema = [
  { id: 1, name: "conversation_key_version", type: T.STRING },
  { id: 2, name: "conversation_participant_keys", type: T.LIST, elemType: T.STRUCT, elemSchema: ConversationParticipantKeySchema },
  { id: 3, name: "ratchet_tree", type: T.STRUCT, schema: KeyRotationSchema },
];

export const StoredGroupStateSchema: Schema = [
  { id: 1, name: "keypairs", type: T.LIST, elemType: T.STRUCT, elemSchema: MaybeKeypairSchema },
  { id: 2, name: "ratchet_tree", type: T.STRUCT, schema: RatchetTreeSchema },
];

export const RichTextEntitySchema: Schema = [
  { id: 1, name: "start_index", type: T.I32 },
  { id: 2, name: "end_index", type: T.I32 },
  { id: 3, name: "content", type: T.STRUCT, schema: RichTextContentSchema },
];

export const ReplyingToPreviewSchema: Schema = [
  { id: 1, name: "sender_id", type: T.I64, asNumber: true },
  { id: 2, name: "message_text", type: T.STRING },
  { id: 3, name: "entities", type: T.LIST, elemType: T.STRUCT, elemSchema: RichTextEntitySchema },
  { id: 4, name: "attachments", type: T.LIST, elemType: T.STRUCT, elemSchema: MessageAttachmentSchema },
  { id: 5, name: "sender_display_name", type: T.STRING },
  { id: 6, name: "replying_to_message_sequence_id", type: T.STRING },
  { id: 7, name: "replying_to_message_id", type: T.STRING },
];

export const QuickReplyRequestSchema: Schema = [
  { id: 1, name: "options", type: T.STRUCT, schema: QuickReplyOptionsRequestSchema },
];

export const QuickReplySchema: Schema = [
  { id: 1, name: "request", type: T.STRUCT, schema: QuickReplyRequestSchema },
  { id: 2, name: "response", type: T.STRUCT, schema: QuickReplyResponseSchema },
];

export const MessageEditSchema: Schema = [
  { id: 1, name: "message_sequence_id", type: T.STRING },
  { id: 2, name: "updated_text", type: T.STRING },
  { id: 3, name: "entities", type: T.LIST, elemType: T.STRUCT, elemSchema: RichTextEntitySchema },
];

export const GroupChangeEventSchema: Schema = [
  { id: 1, name: "group_change", type: T.STRUCT, schema: GroupChangeSchema },
];

export const ForwardedMessageSchema: Schema = [
  { id: 1, name: "message_text", type: T.STRING },
  { id: 2, name: "entities", type: T.LIST, elemType: T.STRUCT, elemSchema: RichTextEntitySchema },
];

export const MessageEventDetailSchema: Schema = [
  { id: 1, name: "messageCreateEvent", type: T.STRUCT, schema: MessageCreateEventSchema },
  { id: 3, name: "conversationKeyChangeEvent", type: T.STRUCT, schema: ConversationKeyChangeEventSchema },
  { id: 4, name: "groupChangeEvent", type: T.STRUCT, schema: GroupChangeEventSchema },
  { id: 5, name: "messageFailureEvent", type: T.STRUCT, schema: MessageFailureEventSchema },
  { id: 6, name: "messageTypingEvent", type: T.STRUCT, schema: MessageTypingEventSchema },
  { id: 7, name: "messageDeleteEvent", type: T.STRUCT, schema: MessageDeleteEventSchema },
  { id: 8, name: "conversationDeleteEvent", type: T.STRUCT, schema: ConversationDeleteEventSchema },
  { id: 9, name: "conversationMetadataChangeEvent", type: T.STRUCT, schema: ConversationMetadataChangeEventSchema },
  { id: 10, name: "grokSearchResponseEvent", type: T.STRUCT, schema: GrokSearchResponseEventSchema },
  { id: 11, name: "requestForEncryptedResendEvent", type: T.STRUCT, schema: RequestForEncryptedResendEventSchema },
  { id: 12, name: "markConversationReadEvent", type: T.STRUCT, schema: MarkConversationReadEventSchema },
  { id: 13, name: "markConversationUnreadEvent", type: T.STRUCT, schema: MarkConversationUnreadEventSchema },
  { id: 14, name: "memberAccountDeleteEvent", type: T.STRUCT, schema: MemberAccountDeleteEventSchema },
];

export const MessageEventSchema: Schema = [
  { id: 1, name: "sequence_id", type: T.STRING },
  { id: 2, name: "message_id", type: T.STRING },
  { id: 3, name: "sender_id", type: T.STRING },
  { id: 4, name: "conversation_id", type: T.STRING },
  { id: 5, name: "conversation_token", type: T.STRING },
  { id: 6, name: "created_at_msec", type: T.STRING },
  { id: 7, name: "detail", type: T.STRUCT, schema: MessageEventDetailSchema },
  { id: 8, name: "relay_source", type: T.I32 },
  { id: 9, name: "message_event_signature", type: T.STRUCT, schema: MessageEventSignatureSchema },
  { id: 10, name: "previous_sequence_id", type: T.STRING },
  { id: 11, name: "is_trusted", type: T.BOOL },
];

export const MessageContentsSchema: Schema = [
  { id: 1, name: "message_text", type: T.STRING },
  { id: 2, name: "entities", type: T.LIST, elemType: T.STRUCT, elemSchema: RichTextEntitySchema },
  { id: 3, name: "attachments", type: T.LIST, elemType: T.STRUCT, elemSchema: MessageAttachmentSchema },
  { id: 4, name: "replying_to_preview", type: T.STRUCT, schema: ReplyingToPreviewSchema },
  { id: 6, name: "forwarded_message", type: T.STRUCT, schema: ForwardedMessageSchema },
  { id: 7, name: "sent_from", type: T.I32 },
  { id: 8, name: "quick_reply", type: T.STRUCT, schema: QuickReplySchema },
  { id: 9, name: "ctas", type: T.LIST, elemType: T.STRUCT, elemSchema: CallToActionSchema },
];

export const BatchedMessageEventsSchema: Schema = [
  { id: 1, name: "message_events", type: T.LIST, elemType: T.STRUCT, elemSchema: MessageEventSchema },
];

export const MessageEntryContentsSchema: Schema = [
  { id: 1, name: "message", type: T.STRUCT, schema: MessageContentsSchema },
  { id: 2, name: "reaction_add", type: T.STRUCT, schema: MessageReactionAddSchema },
  { id: 3, name: "reaction_remove", type: T.STRUCT, schema: MessageReactionRemoveSchema },
  { id: 4, name: "message_edit", type: T.STRUCT, schema: MessageEditSchema },
  { id: 5, name: "mark_conversation_read", type: T.STRUCT, schema: MarkConversationReadSchema },
  { id: 6, name: "mark_conversation_unread", type: T.STRUCT, schema: MarkConversationUnreadSchema },
  { id: 7, name: "pin_conversation", type: T.STRUCT, schema: PinConversationSchema },
  { id: 8, name: "unpin_conversation", type: T.STRUCT, schema: UnpinConversationSchema },
  { id: 9, name: "screen_capture_detected", type: T.STRUCT, schema: ScreenCaptureDetectedSchema },
  { id: 10, name: "av_call_ended", type: T.STRUCT, schema: AVCallEndedSchema },
  { id: 11, name: "av_call_missed", type: T.STRUCT, schema: AVCallMissedSchema },
  { id: 12, name: "draft_message", type: T.STRUCT, schema: DraftMessageSchema },
  { id: 13, name: "accept_message_request", type: T.STRUCT, schema: AcceptMessageRequestSchema },
  { id: 14, name: "nickname_message", type: T.STRUCT, schema: NicknameMessageSchema },
  { id: 15, name: "set_verified_status", type: T.STRUCT, schema: SetVerifiedStatusSchema },
  { id: 16, name: "av_call_started", type: T.STRUCT, schema: AVCallStartedSchema },
];

export const MessageSchema: Schema = [
  { id: 1, name: "messageEvent", type: T.STRUCT, schema: MessageEventSchema },
  { id: 2, name: "messageInstruction", type: T.STRUCT, schema: MessageInstructionSchema },
  { id: 3, name: "batchedMessageEvents", type: T.STRUCT, schema: BatchedMessageEventsSchema },
];

export const MessageEntryHolderSchema: Schema = [
  { id: 1, name: "contents", type: T.STRUCT, schema: MessageEntryContentsSchema },
];

