namespace RemitImap;

@doc("Cursor integrity state machine for a mailbox's stored UIDs (epic #1281 invariant 5, issue #1272). A UIDVALIDITY bump invalidates every stored UID on the mailbox's axis — this tracks whether the stored axis can still be trusted against the server.")
enum MailboxCursorState {
  @doc("Stored UIDs (lastSyncUid, highWaterMarkUid, per-message UIDs) are trustworthy; outbound IMAP operations proceed normally. Absent/undefined on a mailbox row is equivalent to `normal` (rows created before this field existed).")
  normal: "normal",

  @doc("A served UIDVALIDITY no longer matches the stored value. All outbound IMAP operations that would use a stored UID are paused until a rebuild resolves this. Local reads and local actions are unaffected.")
  cursor_invalid: "cursor_invalid",

  @doc("An envelope-level rebuild is re-keying stored UIDs against the new axis (UID + Message-ID + INTERNALDATE match, no body fetches). Outbound IMAP operations stay paused. A rebuild that crashes mid-way leaves the mailbox here, never falling back to `normal` on stale UIDs — the next attempt resumes the rebuild from scratch (idempotent).")
  rebuilding: "rebuilding",
}
