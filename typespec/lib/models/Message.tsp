import "typespec-electrodb-emitter";

import "../enums/MessageCategory.tsp";
import "../enums/MessageFlag.tsp";
import "../enums/MessageStatus.tsp";
import "../enums/MessageSyncStatus.tsp";
import "../enums/SenderTrust.tsp";
import "../enums/StarColor.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Core message entity. The combination of Mailbox.uidValidity + Message.uid uniquely identifies a message forever per RFC 9051 Section 2.3.1.1.")
@entity("message", "remit")
// Used for atomical operations: batch get/put/delete
@index(
  "Message",
  {
    pk: [Message.messageId],
    sk: [],
  }
)
// List all messages for mailbox
@index(
  "byMailboxId",
  {
    collection: "message",
    index: "gsi0",
    pk: [Message.mailboxId],
    sk: [Message.uid],
  }
)
// Collection to retrieve message with related data
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [Message.messageId],
    sk: [],
  }
)
model Message {
  @doc("Primary identifier (internal UUID)")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent mailbox")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("IMAP UID - unique within mailbox, strictly ascending, never reused under same UIDVALIDITY")
  @visibility(Lifecycle.Read)
  @minValue(1)
  uid: int64;

  @doc("Relative position (1-based), changes on EXPUNGE")
  @visibility(Lifecycle.Read)
  @minValue(1)
  sequenceNumber: int32;

  @doc("Message size in octets in RFC 5322 format")
  @visibility(Lifecycle.Read)
  @minValue(0)
  rfc822Size: int64;

  @doc("Server receipt timestamp (INTERNALDATE)")
  @visibility(Lifecycle.Read)
  internalDate: int64;

  @doc("Message-ID header value for quick reference")
  @visibility(Lifecycle.Read)
  messageIdHeader?: string;

  @doc("Reference to parsed envelope data")
  @visibility(Lifecycle.Read)
  envelopeId: UUID;

  @doc("Reference to root body part for BODYSTRUCTURE")
  @visibility(Lifecycle.Read)
  rootBodyPartId: UUID;

  @doc("Storage URI for the message body (set when body has been fetched and stored)")
  @visibility(Lifecycle.Read)
  bodyStorageKey?: string;

  @doc("Message lifecycle status for move/delete operations")
  @visibility(Lifecycle.Read)
  status?: MessageStatus;

  @doc("Sync status for move/delete operations")
  @visibility(Lifecycle.Read)
  syncStatus?: MessageSyncStatus;

  @doc("Original mailbox ID before move (for restore from trash)")
  @visibility(Lifecycle.Read)
  originalMailboxId?: UUID;

  @doc("Original UID before move (for debugging/audit)")
  @visibility(Lifecycle.Read)
  originalUid?: int64;

  @doc("Header-derived category. Absent for messages synced before this rolled out.")
  @visibility(Lifecycle.Read)
  category?: MessageCategory;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Message flags as defined in RFC 9051 Section 2.3.2")
@entity("messageFlag", "remit")
@index(
  "MessageFlag",
  {
    pk: [MessageFlag.messageFlagId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [MessageFlag.messageId],
    sk: [MessageFlag.messageFlagId],
  }
)
model MessageFlag {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  messageFlagId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Flag value: system flag, common keyword, or custom keyword")
  @visibility(Lifecycle.Read)
  flagName: MessageFlagValue;

  @doc("When the flag was set")
  @visibility(Lifecycle.Read)
  setAt: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

// ============================================
// API Response Models
// ============================================

@doc("Core message metadata for API responses")
model MessageSummaryResponse
  is PickProperties<
    Message,

      | "messageId"
      | "mailboxId"
      | "uid"
      | "rfc822Size"
      | "internalDate"
      | "messageIdHeader"
  >;

@doc("Message envelope (header metadata)")
model EnvelopeResponse {
  @doc("Reference to parent message")
  messageId: UUID;

  @doc("Message date")
  date: int64;

  @doc("Message subject")
  subject?: string;

  @doc("RFC 2822 Message-ID header value")
  messageIdValue?: string;

  @doc("From addresses")
  from: EnvelopeAddressResponse[];

  @doc("To addresses")
  to: EnvelopeAddressResponse[];

  @doc("CC addresses")
  cc: EnvelopeAddressResponse[];

  @doc("BCC addresses")
  bcc: EnvelopeAddressResponse[];

  @doc("Reply-To addresses")
  replyTo: EnvelopeAddressResponse[];

  @doc("Header-derived category for the message. Absent for messages synced before classification rolled out.")
  category?: MessageCategory;

  @doc("Trust level for the From address, derived from AddressFlags at read time.")
  senderTrust: SenderTrust;
}

@doc("Complete message description including all related data")
model DescribeMessageResponse {
  @doc("Core message metadata")
  message: MessageSummaryResponse;

  @doc("Envelope data")
  envelope: EnvelopeResponse;

  @doc("Message flags")
  flags: string[];

  @doc("Body structure")
  bodyParts: BodyPartResponse[];

  @doc("Message references (In-Reply-To and References headers)")
  references: MessageReferenceResponse[];

  @doc("Plain text body content")
  bodyText?: string;

  @doc("HTML body content (sanitize before rendering)")
  bodyHtml?: string;

  @doc("CloudFront-hosted URL for fetching the parsed message body. Optional during rollout in #224 PR 1; will be required after CloudFront content delivery is enabled in a later PR. When set, clients should fetch this URL instead of inlining `bodyText` / `bodyHtml`.")
  contentUrl?: string;
}

// ============================================
// API Input Models
// ============================================

@doc("Input for updating message flags (translated to IMAP flags server-side)")
model UpdateFlagsInput {
  @doc("Set message as read (maps to \\Seen flag)")
  isRead?: boolean;

  @doc("Set message as starred (maps to \\Flagged flag)")
  isStarred?: boolean;

  @doc("Star color for visual categorization")
  starColor?: StarColor;
}

@doc("Input for bulk message operations")
model BulkMessageInput {
  @doc("List of message IDs to operate on")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];
}

@doc("Input for moving messages")
model MoveMessagesInput {
  ...BulkMessageInput;

  @doc("Destination mailbox ID")
  destinationMailboxId: UUID;
}

@doc("Bulk operation result for message operations")
model MessageBulkOperationResult {
  @doc("Number of items successfully processed")
  successCount: int32;

  @doc("Number of items that failed")
  failureCount: int32;

  @doc("IDs of failed items")
  failedIds?: UUID[];
}

// ============================================
// Bulk Flag Update
// ============================================

@doc("Input for bulk flag update operations")
model BulkUpdateFlagsInput {
  @doc("List of message IDs to update")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Set messages as read (maps to \\Seen flag)")
  isRead?: boolean;

  @doc("Set messages as starred (maps to \\Flagged flag)")
  isStarred?: boolean;

  @doc("Star color for visual categorization")
  starColor?: StarColor;
}

// ============================================
// Delete Messages (with options)
// ============================================

@doc("Input for deleting messages")
model DeleteMessagesInput {
  @doc("List of message IDs to delete")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Permanently delete instead of moving to Trash. Default: false")
  permanent?: boolean;
}

// ============================================
// Copy Messages
// ============================================

@doc("Input for copying messages to another mailbox")
model CopyMessagesInput {
  @doc("List of message IDs to copy")
  @minItems(1)
  @maxItems(100)
  messageIds: UUID[];

  @doc("Destination mailbox ID")
  destinationMailboxId: UUID;
}

// ============================================
// Empty Trash Response
// ============================================

@doc("Response from emptying trash")
model EmptyTrashResponse {
  @doc("Number of messages permanently deleted")
  deletedCount: int32;
}
