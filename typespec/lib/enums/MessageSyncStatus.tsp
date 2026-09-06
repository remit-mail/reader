namespace RemitImap;

@doc("""
  Sync status for message move/delete operations. Read it as a pair with
  `MessageStatus`, never alone — the six placement states and the transitions
  between them are `docs/architecture/imap-mutations.md` R3.
  """)
enum MessageSyncStatus {
  @doc("Synced with IMAP server")
  synced: "synced",

  @doc("Pending sync to IMAP server. On an `active` row this means nothing: an ordinary inbound sync writes it and nothing later promotes it.")
  pending: "pending",

  @doc("A transient attempt failed and a redelivery is coming. NOT a give-up: the move, delete and copy handlers write this and re-throw for the queue, leaving `status` at its in-flight value. A dependent mutation waits on it rather than refusing.")
  failed: "failed",

  @doc("The mutation gave up. Terminal: nothing is coming for this row. Written only alongside `status: active`, and only after the row has been put back on a placement the server confirmed — so the pair is a faithful projection that carries the failure, and a sighting may repair it.")
  abandoned: "abandoned",
}
