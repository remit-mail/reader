import { trashMailboxAt } from "@remit/data-ports/folder-role";
import { accept, invalid, type Refusable } from "@remit/mailbox-service";
import type { McpDeps } from "./deps.js";

export const trashFolderOf = async (
	deps: Pick<McpDeps, "mailboxSpecialUse">,
	accountId: string,
): Promise<Refusable<string>> => {
	const trash = trashMailboxAt(
		await deps.mailboxSpecialUse.resolveTrashRole(accountId),
		"resolved",
	);
	if (!trash.allowed) {
		return invalid(
			`Account ${accountId} has no Trash folder Remit can move mail into. Set one under Folder roles in settings.`,
		);
	}
	return accept(trash.mailbox.mailboxId);
};
