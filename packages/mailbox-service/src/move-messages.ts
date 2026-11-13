import type {
	IAccountRepository,
	ILabelMailboxRepository,
	ILabelRepository,
	IMailboxRepository,
	IMessageLabelRepository,
	IMessageRepository,
} from "@remit/data-ports";
import type { MessageMoveService } from "./message-move.js";
import {
	folderInAccount,
	ownedMessages,
	ownedMessagesByAccount,
	settledFolder,
} from "./ownership.js";
import { accept, invalid, type Refusable } from "./refusal.js";

export type MoveTarget = { mailboxId: string } | { labelId: string };

export type MoveDestination =
	| { kind: "Folder"; mailboxId: string }
	| { kind: "Label"; mailboxId: string; labelId: string };

export interface DestinationDeps {
	mailbox: Pick<IMailboxRepository, "get">;
	label: Pick<ILabelRepository, "get">;
	labelMailbox: Pick<ILabelMailboxRepository, "get">;
}

export interface MoveMessagesDeps extends DestinationDeps {
	message: Pick<IMessageRepository, "get">;
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	messageMove: Pick<MessageMoveService, "moveMessages">;
	messageLabel: Pick<IMessageLabelRepository, "apply">;
}

export interface MovedGroup {
	accountId: string;
	destinationMailboxId: string;
	messageIds: string[];
}

// A destination binds only to a folder of the account itself that the mail
// server has confirmed: the row records the destination before the move
// settles, so binding to a folder that may never exist leaves the message
// pointing at nothing (imap-mutations R2: wait).
const confirmedFolder = async (
	deps: Pick<DestinationDeps, "mailbox">,
	accountId: string,
	mailboxId: string,
): Promise<Refusable<string>> => {
	const folder = await deps.mailbox.get(accountId, mailboxId);
	const owned = folderInAccount(folder, accountId, "act");
	if (!owned.ok) return owned;
	const settled = settledFolder(folder);
	if (!settled.ok) return settled;
	return accept(folder.mailboxId);
};

// A label is a folder in each account plus a tag on the message, the way a
// label filter files new mail: its destination is the label's folder in the
// account the messages are in.
export const resolveMoveDestination = async (
	deps: DestinationDeps,
	accountConfigId: string,
	accountId: string,
	target: MoveTarget,
): Promise<Refusable<MoveDestination>> => {
	if ("mailboxId" in target) {
		const folder = await confirmedFolder(deps, accountId, target.mailboxId);
		if (!folder.ok) return folder;
		return accept({ kind: "Folder", mailboxId: folder.value });
	}
	const label = await deps.label.get(accountConfigId, target.labelId);
	const mapped = await deps.labelMailbox.get(label.labelId, accountId);
	if (!mapped) {
		return invalid(
			`Label “${label.name}” has no folder in this account yet. Create the label again to add the missing folder`,
		);
	}
	const folder = await confirmedFolder(deps, accountId, mapped.mailboxId);
	if (!folder.ok) return folder;
	return accept({
		kind: "Label",
		mailboxId: folder.value,
		labelId: label.labelId,
	});
};

const groupsFor = async (
	deps: MoveMessagesDeps,
	accountConfigId: string,
	messageIds: string[],
	target: MoveTarget,
): Promise<Refusable<Map<string, string[]>>> => {
	if ("labelId" in target) {
		return ownedMessagesByAccount(deps, messageIds, accountConfigId, "act");
	}
	const owned = await ownedMessages(deps, messageIds, accountConfigId, "act");
	if (!owned.ok) return owned;
	return accept(new Map([[owned.value, messageIds]]));
};

// A folder belongs to one account, so a folder move takes one account's
// messages. A label has a folder in every account, so a label move files each
// account's messages into that account's folder. Every destination resolves
// before the first move is written, so a refusal lands before any part of the
// batch has committed.
export const moveMessagesTo = async (
	deps: MoveMessagesDeps,
	accountConfigId: string,
	messageIds: string[],
	target: MoveTarget,
): Promise<Refusable<MovedGroup[]>> => {
	const groups = await groupsFor(deps, accountConfigId, messageIds, target);
	if (!groups.ok) return groups;
	const planned: Array<{
		accountId: string;
		messageIds: string[];
		destination: MoveDestination;
	}> = [];
	for (const [accountId, ids] of groups.value) {
		const destination = await resolveMoveDestination(
			deps,
			accountConfigId,
			accountId,
			target,
		);
		if (!destination.ok) return destination;
		planned.push({
			accountId,
			messageIds: ids,
			destination: destination.value,
		});
	}
	for (const { accountId, messageIds: ids, destination } of planned) {
		await deps.messageMove.moveMessages(
			accountConfigId,
			ids,
			destination.mailboxId,
			accountId,
		);
		if (destination.kind !== "Label") continue;
		for (const messageId of ids) {
			await deps.messageLabel.apply({
				accountConfigId,
				messageId,
				labelId: destination.labelId,
			});
		}
	}
	return accept(
		planned.map(({ accountId, messageIds: ids, destination }) => ({
			accountId,
			destinationMailboxId: destination.mailboxId,
			messageIds: ids,
		})),
	);
};
