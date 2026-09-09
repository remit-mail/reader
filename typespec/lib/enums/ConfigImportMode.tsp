namespace RemitImap;

@doc("Whether an import writes. The default is the dry run, so the wizard can show what a file would do before anything lands.")
enum ConfigImportMode {
  @doc("Parse, migrate, validate and collision-check; write nothing")
  Validate: "validate",

  @doc("Everything `validate` does, then apply the document")
  Apply: "apply",
}
