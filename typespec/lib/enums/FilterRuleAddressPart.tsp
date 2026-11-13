namespace RemitImap;

@doc("The part of the From address a FilterRule address test reads (RFC 040). `RegistrableDomain` is the public-suffix aware domain.")
enum FilterRuleAddressPart {
  All: "All",
  Localpart: "Localpart",
  Domain: "Domain",
  RegistrableDomain: "RegistrableDomain",
}
