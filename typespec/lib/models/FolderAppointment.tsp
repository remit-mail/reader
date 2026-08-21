import "typespec-electrodb-emitter";

import "../enums/CanonicalMailboxRole.tsp";
import "../enums/FolderAppointmentSource.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Per-account appointment of a canonical role to at most one mailbox (RFC 032 exclusive-folder-appointment, issue #976). A role with no `mailboxId` is unfilled — either genuinely unappointed, or the account has no matching folder yet. Persisted as per-(account, role) AccountSetting rows (RFC 032 settings tiers), surfaced on AccountResponse.folderAppointments — never on the Mailbox entity, so two folders can never both claim the same role.")
model FolderAppointment {
  @doc("Which canonical role this entry fills.")
  role: CanonicalMailboxRole;

  @doc("Where `mailboxId` came from. Read this rather than inferring provenance from the shape of the entry: only `Appointed` means a person decided, and only `Appointed` and `Flagged` are evidence strong enough to destroy mail with.")
  source: FolderAppointmentSource;

  @doc("The mailbox this role resolves to. Absent when resolution names none — `source: None`, or a `Stale` appointment with nothing to fall back to.")
  mailboxId?: UUID;

  @doc("The mailbox the user appointed, when the account no longer holds it. Present exactly when `source` is `Stale`; the appointment is kept rather than collected, so the user can repair it instead of silently losing the choice.")
  staleAppointmentMailboxId?: UUID;

  @doc("The path that stale mailbox last had, recorded beside the appointment when it was made. Display only — resolution never reads it — and present only alongside `staleAppointmentMailboxId`, and only for an appointment made after the path was first recorded.")
  staleAppointmentPath?: String512;
}

@doc("Input for PUT /accounts/{accountId}/folder-roles/{role}. Appoints the mailbox to the role, replacing whichever mailbox previously held it (exclusive by construction — the map has one slot per role). Pass `mailboxId: null` to clear the role back to unfilled.")
model AppointFolderRoleInput {
  @doc("Mailbox to appoint to the role, or `null` to clear the appointment. Typed as an inline nullable string rather than `UUID | null`: a named scalar union renders as allOf + nullable with no sibling type, which openapi-backend's AJV rejects for a `null` value — the same gotcha documented on RenameMailboxInput.displayNameOverride. An inline string keeps `null` valid at the wire; the handler validates the value as a UUID.")
  mailboxId: string | null;
}
