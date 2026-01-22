@doc("Mailbox attributes per RFC 9051 Section 7.3.1")
enum MailboxAttribute {
  @doc("Mailbox does not exist")
  NonExistent: "\\NonExistent",

  @doc("No child mailboxes allowed")
  NoInferiors: "\\Noinferiors",

  @doc("Cannot be selected")
  NoSelect: "\\Noselect",

  @doc("Has child mailboxes")
  HasChildren: "\\HasChildren",

  @doc("Has no child mailboxes")
  HasNoChildren: "\\HasNoChildren",

  @doc("Marked as interesting by server")
  Marked: "\\Marked",

  @doc("Not marked as interesting")
  Unmarked: "\\Unmarked",

  @doc("User is subscribed to this mailbox")
  Subscribed: "\\Subscribed",

  @doc("Mailbox is remote/non-local")
  Remote: "\\Remote",
}
