import type {
	AppointFolderRoleInput,
	CanonicalMailboxRole,
} from "@remit/api-openapi-types";
import { appointFolderRoleFor } from "../service/mail-action-operations.js";
import type {
	FolderRoleOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
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

		return appointFolderRoleFor(
			ctx.client,
			accountConfigId,
			accountId,
			role,
			body,
		);
	},
};
