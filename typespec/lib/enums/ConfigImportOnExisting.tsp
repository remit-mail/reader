namespace RemitImap;

@doc("What an import does when the configuration it is importing into is not empty.")
enum ConfigImportOnExisting {
  @doc("Refuse with 409 `config_not_empty`")
  Abort: "abort",

  @doc("Upsert by natural key. The file's values overwrite; nothing absent from the file is deleted.")
  Merge: "merge",
}
