import type { IMailboxSpecialUseRepository } from "@remit/data-ports";
import type { FolderPlacement } from "./heuristics/classifyPlacement.js";

export type FolderPlacementLookup = Pick<
	IMailboxSpecialUseRepository,
	"findJunkMailbox" | "findInboxMailbox"
>;

export const resolveFolderPlacement = async (
	lookup: FolderPlacementLookup,
	accountId: string,
	mailboxId: string,
): Promise<FolderPlacement> => {
	const junkMailbox = await lookup.findJunkMailbox(accountId);
	if (junkMailbox?.mailboxId === mailboxId) return "junk";
	const inboxMailbox = await lookup.findInboxMailbox(accountId);
	if (inboxMailbox?.mailboxId === mailboxId) return "inbox";
	return "other";
};

export const resolveAccountFolderPlacements = async (
	lookup: FolderPlacementLookup,
	accountIds: readonly string[],
): Promise<ReadonlyMap<string, FolderPlacement>> => {
	const placements = new Map<string, FolderPlacement>();
	for (const accountId of accountIds) {
		const inboxMailbox = await lookup.findInboxMailbox(accountId);
		if (inboxMailbox) placements.set(inboxMailbox.mailboxId, "inbox");
		const junkMailbox = await lookup.findJunkMailbox(accountId);
		if (junkMailbox) placements.set(junkMailbox.mailboxId, "junk");
	}
	return placements;
};
