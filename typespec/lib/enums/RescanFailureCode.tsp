namespace RemitImap;

@doc("Why a rescan left one message unchecked (RFC 041). A caller retries only the retryable codes.")
enum RescanFailureCode {
  @doc("The model provider refused a call for its rate limit. Retryable.")
  RateLimited: "RateLimited",

  @doc("The account reached its daily model limit. Retryable the next day.")
  DailyCap: "DailyCap",

  @doc("A move of the message is still settling on the mail server, so `move` cannot place it yet. Retryable.")
  NotSettled: "NotSettled",

  @doc("No message with this id, or no stored body to read. Not retryable.")
  NotFound: "NotFound",

  @doc("The message belongs to another account. Not retryable.")
  NotPermitted: "NotPermitted",
}
