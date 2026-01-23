import "typespec-electrodb-emitter";

import "../enums/AddressRole.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Normalized email address per RFC 2822 Section 3.4.1. Addresses are deduplicated across messages within an account config.")
@entity("address", "remit")
@index(
  "Address",
  {
    pk: [Address.addressId],
    sk: [],
  }
)
// Part of accountConfig collection for address book queries
@index(
  "byAccountConfigId",
  {
    collection: "accountConfig",
    index: "gsi1",
    pk: [Address.accountConfigId],
    sk: [Address.normalizedCompound],
  }
)
model Address {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  addressId: UUID;

  @doc("Reference to parent account configuration")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Personal name phrase (display-name in RFC 2822)")
  @visibility(Lifecycle.Read)
  displayName?: string;

  @doc("Local-part before @ (addr-mailbox)")
  @visibility(Lifecycle.Read)
  @minLength(1)
  localPart: string;

  @doc("Domain after @ (addr-host)")
  @visibility(Lifecycle.Read)
  @minLength(1)
  domain: string;

  @doc("Lowercase full email address for matching/deduplication")
  @visibility(Lifecycle.Read)
  normalizedEmail: string;

  @doc("Compound field for autocomplete: lowercase displayName + normalizedEmail")
  @visibility(Lifecycle.Read)
  normalizedCompound: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Junction table linking envelope addresses to normalized addresses. Stores per-message display name since it may vary.")
@entity("envelopeAddress", "remit")
@index(
  "EnvelopeAddress",
  {
    pk: [EnvelopeAddress.envelopeAddressId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [EnvelopeAddress.messageId],
    sk: [EnvelopeAddress.envelopeAddressId],
  }
)
model EnvelopeAddress {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  envelopeAddressId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to the normalized address")
  @visibility(Lifecycle.Read)
  addressId: UUID;

  @doc("Display name as it appeared in this specific message's envelope")
  @visibility(Lifecycle.Read)
  displayName?: string;

  @doc("Role of this address in the envelope (from, to, cc, bcc, sender, reply-to)")
  @visibility(Lifecycle.Read)
  addressRole: AddressRole;

  @doc("Order for multiple addresses in same role (0-indexed)")
  @visibility(Lifecycle.Read)
  @minValue(0)
  addressOrder: int32;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
