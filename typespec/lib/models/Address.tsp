@doc("Normalized email address per RFC 2822 Section 3.4.1. Addresses are deduplicated across messages.")
model Address {
  @doc("Primary identifier")
  addressId: string;

  @doc("Personal name phrase (display-name in RFC 2822)")
  displayName?: string;

  @doc("Obsolete source routing (addr-adl), usually empty per RFC 2822 Section 4.4")
  routingInfo?: string;

  @doc("Local-part before @ (addr-mailbox)")
  @minLength(1)
  localPart: string;

  @doc("Domain after @ (addr-host)")
  @minLength(1)
  domain: string;

  @doc("Lowercase full email address for matching/deduplication")
  normalizedEmail: string;
}
