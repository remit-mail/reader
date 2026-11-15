namespace RemitImap;

@doc("Names a boolean trust flag of `AddressFlags` that `GET /addresses/search` can filter on")
enum AddressTrustFlag {
  @doc("AddressFlags.neverSpam")
  NeverSpam: "neverSpam",

  @doc("AddressFlags.blocked")
  Blocked: "blocked",

  @doc("AddressFlags.vip")
  Vip: "vip",
}
