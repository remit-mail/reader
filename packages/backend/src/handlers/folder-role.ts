import type {
	AppointFolderRoleInput,
	CanonicalMailboxRole,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type { FolderRoleOperationIds, OperationHandler } from "../types.js";
import { toAccountResponse } from "./account-guards.js";
import { loadAccountOverrides } from "./account-overrides.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { loadSignatureForAccount } from "./account-signature.js";
import {
	resolveAccountFolderAppointments,
	writeFolderRoleAppointment,
} from "./folder-role-appointments.js";
import { assertMailboxInAccount } from "./mailbox.js";

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
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, role } = context.request.params as {
			accountId: string;
			role: CanonicalMailboxRole;
		};
		const body = context.request.requestBody as AppointFolderRoleInput;

		const { account, accountSetting, mailbox } = await getClient();
		const existing = await account.get(accountId);
		assertAccountOwnership(existing, accountConfigId, "act");

		if (body.mailboxId) {
			const target = await mailbox.get(accountId, body.mailboxId);
			assertMailboxInAccount(target, accountId, "act");
		}

		await writeFolderRoleAppointment(
			accountSetting,
			accountConfigId,
			accountId,
			role,
			body.mailboxId ?? null,
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
