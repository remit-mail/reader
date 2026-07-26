namespace RemitImap;

@doc("Manual bulk label action (issue #26) — apply or remove a label on a `just these` selection. Never sets `appliedByFilterId`: that field is reserved for filter-driven applies (RFC 034 Decision 3.3).")
enum LabelAction {
  Apply: "Apply",
  Remove: "Remove",
}
