namespace RemitImap;

@doc("Message lifecycle status for move/delete operations")
enum MessageStatus {
  @doc("Normal active message")
  active: "active",

  @doc("Marked for deletion, pending IMAP sync")
  deleting: "deleting",

  @doc("Permanently deleted")
  deleted: "deleted",

  @doc("Being moved, pending IMAP sync")
  moving: "moving",
}
