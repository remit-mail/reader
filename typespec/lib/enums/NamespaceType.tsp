namespace RemitImap;

@doc("IMAP namespace types per RFC 9051 Section 6.3.10")
enum NamespaceType {
  @doc("User's personal mailboxes")
  Personal: "personal",

  @doc("Other users' mailboxes (shared to this user)")
  OtherUsers: "other_users",

  @doc("Shared/public mailboxes")
  Shared: "shared",
}
