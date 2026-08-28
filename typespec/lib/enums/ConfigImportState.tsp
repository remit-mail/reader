namespace RemitImap;

@doc("Lifecycle of one applied configuration import. An import is Complete the moment every folder reference in the file has been bound to a real mailbox; until then it is Pending, waiting on the IMAP discovery that will produce those mailboxes.")
enum ConfigImportState {
  @doc("Applied, and still waiting for discovery to produce the folders it referenced")
  Pending: "Pending",

  @doc("Applied, with every folder reference bound")
  Complete: "Complete",
}
