import type {
	AppointFolderRoleInput,
	CanonicalMailboxRole,
} from "@remit/api-openapi-types";
import {
	folderInAccount,
	ownedAccount,
	settledFolder,
} from "@remit/mailbox-service";
import { unwrap } from "../service/refusal.js";
import type {
	FolderRoleOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
import { toAccountResponse } from "./account-guards.js";
import { loadAccountOverrides } from "./account-overrides.js";
import { loadSignatureForAccount } from "./account-signature.js";
import {
	resolveAccountFolderAppointments,
	writeFolderRoleAppointment,
} from "./folder-role-appointments.js";

/**
 * RFC 032 exclusive-folder-appointment (#976): the single write operation for
 * the per-account role map. `appoint(role, mailboxId)` sets `map[role]` —
 * there is no second place a duplicate appointment could live, so writing a
 * role replaces whichever mailbox previously held it. `mailboxId: null` clears
 * the role back to unfilled.
 */
export const FolderRoleOperations: Record<
	FolderRoleOperationIds,
	OperationHandler<FolderRoleOperationIds>
> = {
	FolderRoleOperations_appointFolderRole: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId, role } = context.request.params as {
			accountId: string;
			role: CanonicalMailboxRole;
		};
		const body = context.request.requestBody as AppointFolderRoleInput;

		const { account, accountSetting, mailbox } = ctx.client;
		const existing = await account.get(accountId);
		unwrap(ownedAccount(existing, accountConfigId, "act"));

		let lastKnownPath: string | undefined;
		if (body.mailboxId) {
			const target = await mailbox.get(accountId, body.mailboxId);
			unwrap(folderInAccount(target, accountId, "act"));
			unwrap(settledFolder(target));
			lastKnownPath = target.fullPath;
		}

		await writeFolderRoleAppointment(
			accountSetting,
			accountConfigId,
			accountId,
			role,
			body.mailboxId ?? null,
			lastKnownPath,
		);

		const [signature, overrides, folderAppointments] = await Promise.all([
			loadSignatureForAccount(accountSetting, accountConfigId, accountId),
			loadAccountOverrides(accountSetting, accountConfigId, accountId),
			resolveAccountFolderAppointments(
				{ mailbox, accountSetting },
				accountConfigId,
				accountId,
			),
		]);

		return toAccountResponse(
			existing,
			signature,
			overrides,
			folderAppointments,
		);
	},
};
