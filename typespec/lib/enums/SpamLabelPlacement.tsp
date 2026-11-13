namespace RemitImap;

@doc("What a `Junk` verdict of one kind does (RFC 041). The owner picks one for `Spam` and one for `Phishing`.")
enum SpamLabelPlacement {
  @doc("Move the message to Junk and label it. The default.")
  MoveToSpam: "MoveToSpam",

  @doc("Leave the message where it arrived and label it, as a `Warn` verdict does.")
  WarnOnly: "WarnOnly",
}
