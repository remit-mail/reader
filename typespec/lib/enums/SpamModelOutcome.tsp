namespace RemitImap;

@doc("What happened to the model call for one checked message (RFC 041 stage 3).")
enum SpamModelOutcome {
  @doc("The model judged the message; its reason is among the verdict's reasons.")
  Answered: "Answered",

  @doc("The message was in the ambiguous band, and the account has no model.")
  NotConfigured: "NotConfigured",

  @doc("The message was in the ambiguous band, and the account had reached its daily model limit.")
  DailyLimit: "DailyLimit",

  @doc("The message was in the ambiguous band, and the provider refused the call for its rate limit.")
  RateLimited: "RateLimited",

  @doc("The score was outside the ambiguous band, so no model call was needed.")
  OutOfBand: "OutOfBand",
}
