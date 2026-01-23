namespace RemitImap;

@doc("Sync status for message move/delete operations")
enum MessageSyncStatus {
  @doc("Synced with IMAP server")
  synced: "synced",

  @doc("Pending sync to IMAP server")
  pending: "pending",

  @doc("Sync failed")
  failed: "failed",
}
