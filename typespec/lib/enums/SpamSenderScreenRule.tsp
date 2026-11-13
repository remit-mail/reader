namespace RemitImap;

@doc("The stage 1 rule that let a message through without a spam check, when the sender decided it (RFC 041).")
enum SpamSenderScreenRule {
  @doc("The owner reported this sender as spam. Placement sends the mail to Junk itself.")
  ReportedSender: "ReportedSender",

  @doc("The owner marked this sender Never in Spam.")
  NeverSpam: "NeverSpam",

  @doc("The owner marked this sender VIP.")
  Vip: "Vip",

  @doc("The sender is well known: the owner replied, or enough non-bulk mail arrived recently.")
  WellKnown: "WellKnown",

  @doc("A newsletter from a sender with earlier mail: it carries List-Unsubscribe and passes DMARC.")
  Newsletter: "Newsletter",
}
