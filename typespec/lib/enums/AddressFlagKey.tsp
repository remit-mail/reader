namespace RemitImap;

@doc("Names a key of `AddressFlags` that a client may address in `PATCH /addresses/{addressId}`. `wellknown` is deliberately absent: it is server-owned, derived from engagement counters, and is never written or removed by a client.")
enum AddressFlagKey {
  @doc("AddressFlags.trusted")
  Trusted: "trusted",

  @doc("AddressFlags.blocked")
  Blocked: "blocked",

  @doc("AddressFlags.muted")
  Muted: "muted",

  @doc("AddressFlags.vip")
  Vip: "vip",

  @doc("AddressFlags.junkOnly")
  JunkOnly: "junkOnly",

  @doc("AddressFlags.category")
  Category: "category",

  @doc("AddressFlags.autoArchive")
  AutoArchive: "autoArchive",

  @doc("AddressFlags.unsubscribed")
  Unsubscribed: "unsubscribed",
}
