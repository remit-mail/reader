namespace RemitImap;

@doc("Why a Filter is Disabled. `None` while the filter is not Disabled; every other value names the one thing that has to change before it can run again.")
enum FilterDisabledReason {
  @doc("The filter is not disabled")
  None: "None",

  @doc("The user turned the filter off")
  UserDisabled: "UserDisabled",

  @doc("An import named a move folder the account does not hold yet; it is being created on the mail server, and the filter turns back on once it exists")
  AwaitingFolder: "AwaitingFolder",

  @doc("The mail server refused to create the folder an import named as this filter's destination")
  FolderCreateFailed: "FolderCreateFailed",

  @doc("The folder this filter moves mail into no longer exists")
  FolderMissing: "FolderMissing",
}
