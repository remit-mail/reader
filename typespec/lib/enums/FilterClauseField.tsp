namespace RemitImap;

@doc("Message attribute a FilterClause matches against — RFC 031's Tier 0 literal predicates (from / subject / has-words).")
enum FilterClauseField {
  From: "From",
  Subject: "Subject",
  HasWords: "HasWords",
}
