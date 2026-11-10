namespace RemitImap;

@doc("Why a classification provider cannot run.")
enum ClassificationUnrunnableReason {
  @doc("No base URL is saved, inherited or given by the preset.")
  NoBaseUrl: "NoBaseUrl",

  @doc("The preset needs a key and none is saved or inherited.")
  NoApiKey: "NoApiKey",
}
