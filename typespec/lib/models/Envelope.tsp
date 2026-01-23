import "typespec-electrodb-emitter";

import "../enums/ReferenceType.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Parsed representation of RFC 2822/5322 header fields (RFC 9051 Section 2.3.5). Contains the core message metadata.")
@entity("envelope", "remit")
@index(
  "Envelope",
  {
    pk: [Envelope.envelopeId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [Envelope.messageId],
    sk: [Envelope.envelopeId],
  }
)
model Envelope {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  envelopeId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Parsed origination date per RFC 2822 Section 3.6.1 - REQUIRED by RFC")
  @visibility(Lifecycle.Read)
  dateValue: int64;

  @doc("Original Date header string for preservation/round-tripping")
  @visibility(Lifecycle.Read)
  dateRaw: string;

  @doc("Subject header per RFC 2822 Section 3.6.5")
  @visibility(Lifecycle.Read)
  subject?: string;

  @doc("Message-ID value per RFC 2822 Section 3.6.4 (without angle brackets)")
  @visibility(Lifecycle.Read)
  messageIdValue?: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Stores In-Reply-To and References identification fields per RFC 2822 Section 3.6.4. Used for message threading.")
@entity("messageReference", "remit")
@index(
  "MessageReference",
  {
    pk: [MessageReference.messageReferenceId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [MessageReference.messageId],
    sk: [MessageReference.messageReferenceId],
  }
)
model MessageReference {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  messageReferenceId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent envelope")
  @visibility(Lifecycle.Read)
  envelopeId: UUID;

  @doc("The msg-id value (without angle brackets)")
  @visibility(Lifecycle.Read)
  messageIdValue: string;

  @doc("Type of reference: in_reply_to or references")
  @visibility(Lifecycle.Read)
  referenceType: ReferenceType;

  @doc("Order within References header (0-indexed). Always 0 for In-Reply-To.")
  @visibility(Lifecycle.Read)
  @minValue(0)
  referenceOrder: int32;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
