namespace RemitImap;

@doc("Mailbox special-use attributes per RFC 6154 and RFC 9051 Section 7.3.1")
enum MailboxSpecialUse {
  @doc("All messages (virtual folder)")
  All: "\\All",

  @doc("Archived messages")
  Archive: "\\Archive",

  @doc("Draft messages")
  Drafts: "\\Drafts",

  @doc("Flagged/starred messages")
  Flagged: "\\Flagged",

  @doc("Junk/spam messages")
  Junk: "\\Junk",

  @doc("Sent messages")
  Sent: "\\Sent",

  @doc("Deleted/trash messages")
  Trash: "\\Trash",

  @doc("Important messages")
  Important: "\\Important",
}
