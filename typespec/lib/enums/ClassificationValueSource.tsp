namespace RemitImap;

@doc("Where a classification setting's value comes from.")
enum ClassificationValueSource {
  @doc("The reader saved it.")
  Saved: "Saved",

  @doc("Inherited from the deployment's classification default.")
  Deployment: "Deployment",

  @doc("The preset's or Remit's built-in default. For the API key: no key.")
  Default: "Default",
}
