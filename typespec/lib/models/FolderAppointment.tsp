import "typespec-electrodb-emitter";

import "../enums/CanonicalMailboxRole.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Per-account appointment of a canonical role to at most one mailbox (RFC 032 exclusive-folder-appointment, issue #976). A role with no `mailboxId` is unfilled — either genuinely unappointed, or the account has no matching folder yet. Persisted as per-(account, role) AccountSetting rows (RFC 032 settings tiers), surfaced on AccountResponse.folderAppointments — never on the Mailbox entity, so two folders can never both claim the same role.")
model FolderAppointment {
  @doc("Which canonical role this entry fills.")
  role: CanonicalMailboxRole;

  @doc("The mailbox appointed to the role. Absent when the role is unfilled — either nothing was detected yet, or the account genuinely has no such folder. When absent on a GET, this is a server-proposed best guess (SPECIAL-USE flag, then the reserved INBOX name, then a weak name hint) rather than a user's persisted choice; it becomes persisted only once the user calls appointFolderRole.")
  mailboxId?: UUID;
}

@doc("Input for PUT /accounts/{accountId}/folder-roles/{role}. Appoints the mailbox to the role, replacing whichever mailbox previously held it (exclusive by construction — the map has one slot per role). Pass `mailboxId: null` to clear the role back to unfilled.")
model AppointFolderRoleInput {
  @doc("Mailbox to appoint to the role, or `null` to clear the appointment. Typed as an inline nullable string rather than `UUID | null`: a named scalar union renders as allOf + nullable with no sibling type, which openapi-backend's AJV rejects for a `null` value — the same gotcha documented on RenameMailboxInput.displayNameOverride. An inline string keeps `null` valid at the wire; the handler validates the value as a UUID.")
  mailboxId: string | null;
}
