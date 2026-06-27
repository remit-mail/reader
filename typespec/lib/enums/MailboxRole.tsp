namespace RemitImap;

@doc("User-facing mailbox role. Mirrors the IMAP SPECIAL-USE roles (RFC 6154) plus `Custom` for a folder that is not a recognised system folder. Used as a user override of the detected role; string-valued so the value survives to zod/runtime.")
enum MailboxRole {
  @doc("Inbox / primary mailbox")
  Inbox: "Inbox",

  @doc("Draft messages")
  Drafts: "Drafts",

  @doc("Sent messages")
  Sent: "Sent",

  @doc("Archived messages")
  Archive: "Archive",

  @doc("Junk/spam messages")
  Junk: "Junk",

  @doc("Deleted/trash messages")
  Trash: "Trash",

  @doc("All messages (virtual folder)")
  All: "All",

  @doc("Flagged/starred messages")
  Flagged: "Flagged",

  @doc("Not a system folder")
  Custom: "Custom",
}
