namespace RemitImap;

@doc("What the owner's mail provider said about a message, as the spam request carries it (RFC 041).")
enum ProviderSpamVerdict {
  @doc("The provider's spam header calls the message spam.")
  Spam: "Spam",

  @doc("The provider's spam header calls the message clean.")
  Clean: "Clean",

  @doc("The message carries no provider spam header.")
  Absent: "Absent",
}
