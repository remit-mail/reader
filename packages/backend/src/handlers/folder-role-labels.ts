import type { IAccountSettingRepository } from "@remit/data-ports";
import {
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentLabelName,
} from "@remit/data-ports/folder-role";
import { rebaseMailboxPath } from "@remit/data-ports/mailbox-name";
import { loadFolderAppointmentsForAccount } from "./folder-role-appointments.js";

/**
 * The label row beside each role appointment records the path its folder had at
 * the time (#887), so a folder another client later deletes can still be named
 * back to the user. It is display only, and it lives here rather than beside
 * the appointment writer because that writer is guarded as the only writer of
 * the appointment row itself.
 *
 * A rename keeps every mailboxId, so an appointment survives it — but the path
 * recorded beside it still names where the folder was. Move the labels with the
 * branch, or a later third-party delete names a path the user has not seen
 * since the rename.
 *
 * Driven by the settle, not by the intent: under D2 the row keeps the path the
 * mail server holds until the rename lands, so a label moved when the intent
 * was recorded would name a path that does not exist — permanently, if the
 * rename then fails.
 *
 * The renamed folder is matched by id; its descendants are matched by the path
 * each label already holds.
 */
export const refreshFolderAppointmentLabels = async (
	accountSetting: Pick<IAccountSettingRepository, "get" | "upsert">,
	accountConfigId: string,
	accountId: string,
	renamed: { mailboxId: string; oldPath: string; newPath: string },
	delimiter: string,
): Promise<void> => {
	const persisted = await loadFolderAppointmentsForAccount(
		accountSetting,
		accountConfigId,
		accountId,
	);
	for (const [role, appointment] of persisted) {
		const moved =
			appointment.mailboxId === renamed.mailboxId
				? renamed.newPath
				: appointment.lastKnownPath === undefined
					? undefined
					: rebaseMailboxPath(
							appointment.lastKnownPath,
							renamed.oldPath,
							renamed.newPath,
							delimiter,
						);
		if (moved === undefined || moved === appointment.lastKnownPath) continue;
		await accountSetting.upsert({
			accountConfigId,
			name: composeFolderRoleAppointmentLabelName(
				accountId,
				role as CanonicalMailboxRoleValue,
			),
			value: { kind: "String", value: moved },
		});
	}
};
