namespace RemitImap;

@doc("Which spam service a deployment runs (RFC 041).")
enum SpamBackend {
  @doc("The inline engine inside Remit.")
  Inline: "Inline",
}
