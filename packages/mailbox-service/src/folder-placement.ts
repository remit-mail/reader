import type { IMailboxSpecialUseRepository } from "@remit/data-ports";
import type { FolderPlacement } from "./heuristics/classifyPlacement.js";

export type FolderPlacementLookup = Pick<
	IMailboxSpecialUseRepository,
	"findJunkMailbox" | "findInboxMailbox"
>;

type RoleMailbox = Awaited<
	ReturnType<IMailboxSpecialUseRepository["findJunkMailbox"]>
>;

export interface FolderRoleMailboxes {
	junkMailbox: RoleMailbox;
	inboxMailbox: RoleMailbox;
}

export const resolveFolderRoleMailboxes = async (
	lookup: FolderPlacementLookup,
	accountId: string,
): Promise<FolderRoleMailboxes> => ({
	junkMailbox: await lookup.findJunkMailbox(accountId),
	inboxMailbox: await lookup.findInboxMailbox(accountId),
});

export const placementOf = (
	mailboxId: string,
	{ junkMailbox, inboxMailbox }: FolderRoleMailboxes,
): FolderPlacement => {
	if (junkMailbox?.mailboxId === mailboxId) return "junk";
	if (inboxMailbox?.mailboxId === mailboxId) return "inbox";
	return "other";
};

export const resolveFolderPlacement = async (
	lookup: FolderPlacementLookup,
	accountId: string,
	mailboxId: string,
): Promise<FolderPlacement> =>
	placementOf(mailboxId, await resolveFolderRoleMailboxes(lookup, accountId));

export const resolveAccountFolderPlacements = async (
	lookup: FolderPlacementLookup,
	accountIds: readonly string[],
): Promise<ReadonlyMap<string, FolderPlacement>> => {
	const placements = new Map<string, FolderPlacement>();
	for (const accountId of accountIds) {
		const { junkMailbox, inboxMailbox } = await resolveFolderRoleMailboxes(
			lookup,
			accountId,
		);
		if (inboxMailbox) placements.set(inboxMailbox.mailboxId, "inbox");
		if (junkMailbox) placements.set(junkMailbox.mailboxId, "junk");
	}
	return placements;
};
