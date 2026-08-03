namespace RemitImap;

@doc("How the From display name relates to the From domain. `Corresponds` — the name is contained in the domain. `Lookalike` — the name is one or two characters away from a domain label. `Unrelated` — no relation. `NoClaim` — the name is empty or is the address itself, so it claims no identity.")
enum DisplayNameCorrespondence {
  Corresponds: "Corresponds",
  Lookalike: "Lookalike",
  Unrelated: "Unrelated",
  NoClaim: "NoClaim",
}
