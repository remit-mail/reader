namespace RemitImap;

@doc("How a Filter's literalClauses combine (RFC 031 \"literal predicates, AND/OR\"). Ignored when literalClauses is empty.")
enum FilterMatchOperator {
  And: "And",
  Or: "Or",
}
