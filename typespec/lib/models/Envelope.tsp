import "../enums/AddressRole.tsp";
import "../enums/ReferenceType.tsp";

namespace RemitImap;

@doc("Parsed representation of RFC 2822/5322 header fields (RFC 9051 Section 2.3.5). Contains the core message metadata.")
model Envelope {
  @doc("Primary identifier")
  envelopeId: string;

  @doc("Parsed origination date per RFC 2822 Section 3.6.1 - REQUIRED by RFC")
  dateValue: utcDateTime;

  @doc("Original Date header string for preservation/round-tripping")
  dateRaw: string;

  @doc("Subject header per RFC 2822 Section 3.6.5")
  subject?: string;

  @doc("Message-ID value per RFC 2822 Section 3.6.4 (without angle brackets)")
  messageIdValue?: string;
}

@doc("Junction table linking envelopes to addresses with roles. Supports both individual mailboxes and group addresses per RFC 2822 Section 3.4.")
model EnvelopeAddress {
  @doc("Primary identifier")
  envelopeAddressId: string;

  @doc("Reference to parent envelope")
  envelopeId: string;

  @doc("Reference to individual address (null if group)")
  addressId?: string;

  @doc("Reference to group address (null if individual)")
  addressGroupId?: string;

  @doc("Role of this address in the message")
  addressRole: AddressRole;

  @doc("Order for multiple addresses in same role (0-indexed)")
  @minValue(0)
  addressOrder: int32;

  @doc("True if this represents a group address")
  isGroup: boolean;
}

@doc("Stores In-Reply-To and References identification fields per RFC 2822 Section 3.6.4. Used for message threading.")
model MessageReference {
  @doc("Primary identifier")
  messageReferenceId: string;

  @doc("Reference to parent envelope")
  envelopeId: string;

  @doc("The msg-id value (without angle brackets)")
  messageIdValue: string;

  @doc("Type of reference: in_reply_to or references")
  referenceType: ReferenceType;

  @doc("Order within References header (0-indexed). Always 0 for In-Reply-To.")
  @minValue(0)
  referenceOrder: int32;
}
