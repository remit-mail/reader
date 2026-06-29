import "typespec-electrodb-emitter";

import "../enums/AddressRole.tsp";
import "../enums/MessageCategory.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

// ============================================
// Sender-level Flags (RFC 019 / EDD #174)
// ============================================
//
// Per-sender preferences stored as a sparse map on Address. Adding a flag is
// a TypeSpec change — forces deliberate UI consideration before a flag goes
// live. Stored as a DDB Map so per-flag updates are atomic across devices.

@doc("Common metadata for sender-level flags")
model AddressFlagBase {
  @doc("Timestamp when the flag was set")
  setAt: int64;

  @doc("Device/session/user identifier that set the flag (audit trail)")
  setBy?: string;

  @doc("Optional auto-revoke timestamp")
  expiresAt?: int64;

  @doc("Free-text user note")
  reason?: string;
}

@doc("Sender is trusted: auto-load images, allow author backgrounds")
model TrustedFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Sender is blocked: never load images, even on explicit click")
model BlockedFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Sender is muted: do not notify on new mail")
model MutedFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Sender is VIP: priority surface and push escalation")
model VipFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Sender is wellknown: engagement counters crossed the promotion threshold")
model WellknownFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Category override for auto-classification")
model CategoryFlag extends AddressFlagBase {
  value: MessageCategory;
}

@doc("Auto-archive: skip inbox, file directly")
model AutoArchiveFlag extends AddressFlagBase {
  value: boolean;
}

@doc("User has unsubscribed; auto-mark-read until sender stops")
model UnsubscribedFlag extends AddressFlagBase {
  value: boolean;
}

@doc("Sender-level flags map. Absent keys mean absent flags (sparse).")
model AddressFlags {
  trusted?: TrustedFlag;
  blocked?: BlockedFlag;
  muted?: MutedFlag;
  vip?: VipFlag;
  wellknown?: WellknownFlag;
  category?: CategoryFlag;
  autoArchive?: AutoArchiveFlag;
  unsubscribed?: UnsubscribedFlag;
}

@doc("Normalized email address per RFC 2822 Section 3.4.1. Addresses are deduplicated across messages within an account config.")
@entity("address", "remit")
@index(
  "Address",
  {
    pk: [Address.addressId],
    sk: [],
  }
)
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

  @doc("Sender-level flags (trust/block/mute/etc). Always present; an empty map means no flags are set. Individual flag keys remain sparse — a key's presence means that flag is set.")
  @visibility(Lifecycle.Read)
  flags: AddressFlags = #{};

  @doc("Number of inbound messages received from this address. Defaults to zero.")
  @visibility(Lifecycle.Read)
  inboundCount: int32 = 0;

  @doc("Number of outbound messages sent to this address. Defaults to zero.")
  @visibility(Lifecycle.Read)
  outboundCount: int32 = 0;

  @doc("Number of user replies to messages from this address. Defaults to zero.")
  @visibility(Lifecycle.Read)
  replyCount: int32 = 0;

  @doc("Timestamp (ms epoch) of the last inbound message from this address. Zero means never.")
  @visibility(Lifecycle.Read)
  lastInboundAt: int64 = 0;

  @doc("Timestamp (ms epoch) of the last outbound message to this address")
  @visibility(Lifecycle.Read)
  lastOutboundAt?: int64;

  @doc("Timestamp (ms epoch) of the last user reply to a message from this address. Zero means never.")
  @visibility(Lifecycle.Read)
  lastReplyAt: int64 = 0;

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

  @doc("Lowercase full email address (denormalized from Address for efficient queries)")
  @visibility(Lifecycle.Read)
  normalizedEmail: string;

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

// ============================================
// API Response Models
// ============================================

@doc("Envelope address information. Includes the resolved Address `addressId` and per-sender `flags` so the UI can render trust state without a second fetch.")
model EnvelopeAddressResponse {
  @doc("Resolved Address identifier (stable per accountConfig + normalized email)")
  addressId: UUID;

  @doc("Display name as it appeared in this specific message's envelope")
  displayName?: string;

  @doc("Lowercase full email address")
  normalizedEmail: string;

  @doc("Role of this address in the envelope")
  addressRole: AddressRole;

  @doc("Order for multiple addresses in same role (0-indexed)")
  addressOrder: int32;

  @doc("Sender-level flags resolved from the linked Address")
  flags?: AddressFlags;
}

// ============================================
// API Input Models
// ============================================

@doc("Patch payload for a single AddressFlags entry. Pass `null` for a flag key to remove that flag while leaving the others untouched.")
model UpdateAddressFlagsInput {
  trusted?: TrustedFlag | null;
  blocked?: BlockedFlag | null;
  muted?: MutedFlag | null;
  vip?: VipFlag | null;
  wellknown?: WellknownFlag | null;
  category?: CategoryFlag | null;
  autoArchive?: AutoArchiveFlag | null;
  unsubscribed?: UnsubscribedFlag | null;
}

@doc("Input for updating an Address (currently flag updates only)")
model UpdateAddressInput {
  @doc("Per-flag merge update; omitted flags are untouched, `null` removes the flag")
  flags?: UpdateAddressFlagsInput;
}

// ============================================
// VIP Suggestion Models (issue #234)
// ============================================

@doc("A reciprocal-engagement candidate for VIP promotion. The user opts in via `PATCH /addresses/{addressId}` with `flags.vip = { value: true, ... }`.")
model VipSuggestionEntry {
  @doc("Resolved Address identifier")
  addressId: UUID;

  @doc("Personal name phrase, when known")
  displayName?: string;

  @doc("Lowercase full email address")
  normalizedEmail: string;

  @doc("Number of inbound messages received from this address")
  inboundCount: int32;

  @doc("Number of outbound messages sent to this address")
  outboundCount: int32;

  @doc("Number of user replies to messages from this address")
  replyCount: int32;

  @doc("Timestamp (ms epoch) of the last user reply to a message from this address")
  lastReplyAt?: int64;

  @doc("Timestamp (ms epoch) of the last inbound message from this address")
  lastInboundAt?: int64;
}

@doc("Response for `GET /me/vip-suggestions` — wellknown senders the user has not yet promoted to VIP, ranked by reciprocal engagement.")
model VipSuggestionsResponse {
  @doc("Up to 10 ranked suggestions; empty when there are no eligible senders yet.")
  suggestions: VipSuggestionEntry[];
}
