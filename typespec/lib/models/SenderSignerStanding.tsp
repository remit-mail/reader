import "typespec-electrodb-emitter";

import "../scalars/string.tsp";

namespace RemitImap;

@doc("""
  How often this account has seen mail from one sender arrive under one DKIM
  signing identity. A third-party signer is not suspicious in itself — an ESP
  signing for its own domain on behalf of a customer is the ordinary shape of
  bulk mail — so what the authenticity derivation asks is whether this sender
  has been seen arriving this way before.
  
  `senderKey` carries two scopes, disambiguated by `signerDomain`: the From
  domain when the signer is a real verified identity, and the full From address
  when `signerDomain` is the reserved literal `unverified`. Address granularity
  on the unverified pseudo-pair is a security boundary — a domain-wide key would
  let one unverifiable message from any address at a domain earn quiet treatment
  for every forged sender at it.
  
  Standing is a noise filter, not an anti-spoofing control. It narrows the
  attack from "rent any established relay" to "rent the relay this specific From
  domain already uses"; it does not close it.
  """)
@entity("senderSignerStanding", "remit")
@index(
  "SenderSignerStanding",
  {
    pk: [SenderSignerStanding.accountConfigId],
    sk: [SenderSignerStanding.senderKey, SenderSignerStanding.signerDomain],
  }
)
model SenderSignerStanding {
  @doc("Owning account configuration. Standing is never shared between accounts.")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Lowercased From domain when `signerDomain` names a real verified signer; the full lowercased From address when `signerDomain` is the reserved literal `unverified`.")
  @visibility(Lifecycle.Read)
  senderKey: String256;

  @doc("Registrable domain of the first verified DKIM `header.d` in trusted Authentication-Results order, or the reserved literal `unverified` when no identity could be established. `unverified` is rejected as a real signer domain on write.")
  @visibility(Lifecycle.Read)
  signerDomain: String256;

  @doc("Messages observed for this key. One increment per message.")
  @visibility(Lifecycle.Read)
  messageCount: int32 = 0;

  @doc("Epoch milliseconds of the first observation. Immutable after creation — the conflict path of the upsert deliberately omits it, so a later message can never reset the key's age.")
  @visibility(Lifecycle.Read)
  firstSeenAt: int64;

  @doc("Epoch milliseconds of the most recent observation.")
  @visibility(Lifecycle.Read)
  lastSeenAt: int64;

  @doc("Epoch milliseconds the user affirmed knowing this sender, promoting `Caution` to `Routine` for the pair. `0` means never affirmed, which is the state of every row until a user acts.")
  @visibility(Lifecycle.Read)
  userAffirmedAt: int64 = 0;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
