namespace RemitImap;

@doc("Whether a Filter runs, backing the byAccountAndState index (RFC 034 Decision 1.2). Active and Disabled are written; Expired is a lazily-patched cache of Filter.expiresAt, which stays the source of truth for expiry. A Disabled filter records why in Filter.disabledReason.")
enum FilterState {
  Active: "Active",
  Expired: "Expired",

  @doc("Turned off, by the user or by the system when the filter cannot work as designed. Evaluation skips it.")
  Disabled: "Disabled",
}
