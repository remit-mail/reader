namespace RemitImap;

@doc("The sync step a message failed at.")
enum SyncWarningStage {
  @doc("Fetching and saving the message's headers: a save that threw, a change that failed to apply, or a FETCH row with no ENVELOPE.")
  Header: "Header",

  @doc("Fetching the message body.")
  Body: "Body",
}
