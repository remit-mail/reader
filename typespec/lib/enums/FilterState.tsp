namespace RemitImap;

@doc("Cache of whether a Filter is still active to evaluate, backing the byAccountAndState index (RFC 034 Decision 1.2). Not the source of truth for expiry — Filter.expiresAt is, compared directly at every evaluation. Starts Active; lazily patched to Expired the first time something reads a Temporary filter past its expiresAt. No Disabled value: this RFC has no flow that pauses a filter without deleting it.")
enum FilterState {
  Active: "Active",
  Expired: "Expired",
}
