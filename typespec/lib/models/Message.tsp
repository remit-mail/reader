import "typespec-electrodb-emitter";

import "../enums/MessageFlag.tsp";
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
