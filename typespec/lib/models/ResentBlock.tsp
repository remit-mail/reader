import "../enums/AddressRole.tsp";

@doc("Groups resent header fields per RFC 2822 Section 3.6.6. Each resending event creates a new block prepended to the message.")
model ResentBlock {
  @doc("Primary identifier")
  resentBlockId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Order of resent blocks (0 = most recent)")
  @minValue(0)
  blockOrder: int32;

  @doc("Resent-Date field value - REQUIRED per RFC 2822 when resent fields are used")
  resentDate: utcDateTime;

  @doc("Resent-Message-ID value (without angle brackets) - SHOULD be present per RFC 2822")
  resentMessageId?: string;
}

@doc("Address roles specific to resent headers")
enum ResentAddressRole {
  @doc("Resent-From - REQUIRED per RFC 2822")
  From: "from",

  @doc("Resent-Sender")
  Sender: "sender",

  @doc("Resent-To")
  To: "to",

  @doc("Resent-Cc")
  Cc: "cc",

  @doc("Resent-Bcc")
  Bcc: "bcc",
}

@doc("Links resent blocks to addresses with roles, similar to EnvelopeAddress.")
model ResentAddress {
  @doc("Primary identifier")
  resentAddressId: string;

  @doc("Reference to parent resent block")
  resentBlockId: string;

  @doc("Reference to the address")
  addressId: string;

  @doc("Role of this address in the resent headers")
  addressRole: ResentAddressRole;

  @doc("Order for multiple addresses in same role (0-indexed)")
  @minValue(0)
  addressOrder: int32;
}
