namespace RemitImap;

@doc("The fixed anchor set of canonical mailbox roles a user appoints to a folder (RFC 032 exclusive-folder-appointment, issue #976). Mirrors the IMAP SPECIAL-USE roles (RFC 6154). Each role resolves to at most one mailbox per account — see FolderAppointment.")
enum CanonicalMailboxRole {
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
}
