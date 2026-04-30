namespace RemitImap;

@doc("Trust level for the From address, derived at read time from AddressFlags + counters.")
enum SenderTrust {
  @doc("Default for first-contact senders or addresses without engagement signal")
  Unknown: "unknown",

  @doc("AddressFlags.wellknown.value === true (engagement counters crossed promotion threshold)")
  Wellknown: "wellknown",

  @doc("AddressFlags.vip.value === true (user opted in)")
  Vip: "vip",
}
