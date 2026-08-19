namespace RemitImap;

@doc("How the From display name relates to the From domain. `Corresponds` — the name is contained in the domain. `Lookalike` — the name is one or two characters away from a domain label. `ForeignAddress` — the name spells out an email address at a domain the sender does not send from. `Unrelated` — no relation. `NoClaim` — the name is empty, or is an address at the sending domain, so it claims no other identity.")
enum DisplayNameCorrespondence {
  Corresponds: "Corresponds",
  Lookalike: "Lookalike",
  ForeignAddress: "ForeignAddress",
  Unrelated: "Unrelated",
  NoClaim: "NoClaim",
}
