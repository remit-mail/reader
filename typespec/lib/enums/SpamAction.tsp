namespace RemitImap;

@doc("What the spam service tells Remit to do with a checked message (RFC 041).")
enum SpamAction {
  @doc("Leave the message alone. Every verdict carries this while the deployment sets no thresholds.")
  None: "None",

  @doc("Leave the message where it arrived and warn the owner.")
  Warn: "Warn",

  @doc("Move the message to Junk.")
  Junk: "Junk",
}
