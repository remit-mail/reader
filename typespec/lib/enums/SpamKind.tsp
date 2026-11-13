namespace RemitImap;

@doc("What the spam service suspects a checked message of (RFC 041).")
enum SpamKind {
  @doc("Unwanted mail that impersonates nobody.")
  Spam: "Spam",

  @doc("Mail that impersonates someone.")
  Phishing: "Phishing",
}
