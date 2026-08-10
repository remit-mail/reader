namespace RemitImap;

@doc("Sender-authenticity tier for a message, resolved at body-sync from the trusted Authentication-Results header and the sender's pair-keyed standing. First match wins, in tier order: `Impersonation`, `Aligned`, `Authenticated`, `Routine`, `NotChecked`, `Caution`. `NotEvaluated` is the sentinel for a message the derivation has never run on — it is the default and what every message written before this field existed carries, and it is distinct from `NotChecked`, which is a result.")
enum AuthenticityVerdict {
  @doc("The derivation has never run for this message. Named pending state, never inferred from absence.")
  NotEvaluated: "NotEvaluated",

  @doc("No verified DKIM identity was established, and the sender's address-keyed pseudo-pair already had standing. Silence is earned by prior observation, not granted by absence of evidence.")
  NotChecked: "NotChecked",

  @doc("A verified DKIM identity aligns with the From domain.")
  Aligned: "Aligned",

  @doc("SPF passed and the envelope-from domain aligns with the From domain, with no aligned DKIM signature.")
  Authenticated: "Authenticated",

  @doc("A verified DKIM identity exists but is misaligned with the From domain, and the (From domain, signer domain) pair has standing in this account.")
  Routine: "Routine",

  @doc("Nothing verified aligned and the sender has no standing — whether the checks ran and found nothing, or nothing was evaluated at all.")
  Caution: "Caution",

  @doc("The message carries a positive impersonation signal: an unreadable From address, a display name unrelated to the domain, a DMARC failure in the trusted Authentication-Results, or off-domain body links.")
  Impersonation: "Impersonation",
}
