namespace RemitImap;

@doc("Why a classification provider call gave no usable answer.")
enum ClassificationFailureKind {
  @doc("The provider answered 401 or 403.")
  Unauthorized: "Unauthorized",

  @doc("The provider answered 404: it does not know the model.")
  ModelNotFound: "ModelNotFound",

  @doc("The provider answered 429.")
  RateLimited: "RateLimited",

  @doc("The provider answered another 4xx.")
  Rejected: "Rejected",

  @doc("The provider answered 5xx.")
  ProviderError: "ProviderError",

  @doc("The connection was refused or never opened.")
  Unreachable: "Unreachable",

  @doc("The provider sent no answer within 10 seconds.")
  TimedOut: "TimedOut",

  @doc("The answer could not be read, or named a label outside the set.")
  Unparseable: "Unparseable",
}
