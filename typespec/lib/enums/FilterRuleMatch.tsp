namespace RemitImap;

@doc("How a FilterRule header or address test compares its key (RFC 040, after Sieve's `:is` and `:contains`). Both fold case.")
enum FilterRuleMatch {
  Is: "Is",
  Contains: "Contains",
}
