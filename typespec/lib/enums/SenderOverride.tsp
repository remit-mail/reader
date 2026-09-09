namespace RemitImap;

@doc("What the user has instructed about a sender's placement, resolved from AddressFlags at read time. An instruction, not a heuristic signal: it outranks every DKIM/DMARC/provider verdict. `SenderTrust` stays a separate axis and is unaffected.")
enum SenderOverride {
  @doc("The user has said nothing about where this sender's mail belongs")
  None: "none",

  @doc("AddressFlags.blocked.value === true (mail is demoted to Junk)")
  Blocked: "blocked",

  @doc("AddressFlags.neverSpam.value === true (mail is rescued from Junk)")
  NeverSpam: "neverSpam",
}
