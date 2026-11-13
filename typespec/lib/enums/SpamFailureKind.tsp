namespace RemitImap;

@doc("Why a spam service gave no verdict (RFC 041).")
enum SpamFailureKind {
  @doc("The service could not be reached.")
  Unreachable: "Unreachable",

  @doc("The service sent no answer in time.")
  TimedOut: "TimedOut",

  @doc("The service answered with an error.")
  ServiceError: "ServiceError",

  @doc("The answer could not be read.")
  Unparseable: "Unparseable",
}
