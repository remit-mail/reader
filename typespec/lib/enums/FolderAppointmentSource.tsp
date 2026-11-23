namespace RemitImap;

@doc("Where a resolved FolderAppointment came from. Total and required: every role carries one, so a surface can tell a folder somebody chose from a folder reader guessed without inferring it from which fields happen to be present.")
enum FolderAppointmentSource {
  @doc("The user appointed this mailbox to the role and it still exists.")
  Appointed: "Appointed",

  @doc("The server's own SPECIAL-USE flag (RFC 6154) names this mailbox.")
  Flagged: "Flagged",

  @doc("The reserved INBOX name (RFC 3501), for the Inbox role only.")
  Reserved: "Reserved",

  @doc("Exactly one mailbox in this account matches the role's conventional name at the root or directly under INBOX, with no appointment or server flag. Trusted for destructive operations.")
  Detected: "Detected",

  @doc("A conventional name proposal: multiple candidates match, or the match is outside the root and INBOX. Carries the best-ranked candidate as a preselection; operations that destroy mail refuse it.")
  Proposed: "Proposed",

  @doc("The user appointed a mailbox this account no longer holds — deleted, or renamed by another client. `staleAppointmentMailboxId` names it and `staleAppointmentPath` carries the path it last had; `mailboxId` is whatever resolution falls back to.")
  Stale: "Stale",

  @doc("Nothing names a mailbox for this role: no appointment, no flag, no conventional name.")
  None: "None",
}
