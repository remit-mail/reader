import type { IMailboxSpecialUseRepository } from "@remit/data-ports";
import { FromPlacement } from "@remit/domain-enums";
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
	if (junkMailbox?.mailboxId === mailboxId) return FromPlacement.Junk;
	if (inboxMailbox?.mailboxId === mailboxId) return FromPlacement.Inbox;
	return FromPlacement.Other;
};

export const resolveFolderPlacement = async (
	lookup: FolderPlacementLookup,
	accountId: string,
	mailboxId: string,
): Promise<FolderPlacement> =>
	placementOf(mailboxId, await resolveFolderRoleMailboxes(lookup, accountId));
