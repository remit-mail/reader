namespace RemitImap;

@doc("Sync status for mailbox operations")
enum MailboxSyncStatus {
  @doc("Mailbox is synchronized with IMAP server")
  synced,

  @doc("Mailbox operation is pending sync to IMAP server")
  pending,

  @doc("Mailbox sync operation failed")
  failed,

  @doc("Mailbox is marked for deletion")
  deleting,
}
