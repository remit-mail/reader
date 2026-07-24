namespace RemitImap;

@doc("Message attribute a FilterClause matches against — RFC 031's Tier 0 literal predicates plus the RFC 038 D2 additions (list membership and sender domain). Every member is matched vector-free at index time and in the back-apply corpus projection.")
enum FilterClauseField {
  From: "From",
  Subject: "Subject",
  HasWords: "HasWords",

  @doc("The `List-Id` header value, matched exactly (never as a substring). The stored and clause values are normalized identically — the bracketed identifier when present, case-folded — so `<weekly.news.example.com>` and `weekly.news.example.com` are the same list, and a message with no `List-Id` never matches.")
  ListId: "ListId",

  @doc("The registrable (public-suffix aware) domain of the From address, matched exactly. `github.com` matches `user@github.com` and `user@sub.github.com` but never `user@github.com.evil.example`, whose registrable domain is `evil.example`.")
  FromDomain: "FromDomain",
}
