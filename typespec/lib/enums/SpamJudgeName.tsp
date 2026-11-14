namespace RemitImap;

@doc("One judge in the deployment's spam pipeline (RFC 041). The judges run in the configured order until one is sure.")
enum SpamJudgeName {
  @doc("The checks running inside Remit.")
  Inline: "Inline",

  @doc("An rspamd server's `/checkv2`.")
  Rspamd: "Rspamd",

  @doc("The account's model, asked with the earlier judges' reasons.")
  Model: "Model",
}
