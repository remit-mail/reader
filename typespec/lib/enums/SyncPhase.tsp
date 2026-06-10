namespace RemitImap;

@doc("Phase of the initial account sync lifecycle")
enum SyncPhase {
  @doc("No sync in progress")
  idle: "idle",

  @doc("Discovering mailboxes from IMAP server")
  discovering_mailboxes: "discovering_mailboxes",

  @doc("INBOX is being synced (messages downloaded)")
  syncing_inbox: "syncing_inbox",

  @doc("Non-INBOX mailboxes are being synced")
  syncing_others: "syncing_others",

  @doc("Initial sync completed successfully")
  complete: "complete",

  @doc("Sync failed; see lastError for details")
  error: "error",
}
