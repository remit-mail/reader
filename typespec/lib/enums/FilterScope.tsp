namespace RemitImap;

@doc("Whether a Filter is permanent or expires (RFC 034 Decision 1). A Filter row exists only for these two standing scopes — the one-time \"just these\" / \"all like these\" batch actions never create one.")
enum FilterScope {
  @doc("Permanent — matches until deleted")
  Standing: "Standing",

  @doc("Expires at Filter.expiresAt (RFC 034 Decision 1.1)")
  Temporary: "Temporary",
}
