import type {
	IAccountRepository,
	ILabelMailboxRepository,
	ILabelRepository,
	IMailboxRepository,
	IMessageLabelRepository,
	IMessageRepository,
} from "@remit/data-ports";
import type { MessageMoveService } from "./message-move.js";
import { folderInAccount, ownedMessages, settledFolder } from "./ownership.js";
import { accept, invalid, type Refusable } from "./refusal.js";

export interface MoveMessagesDeps {
	message: Pick<IMessageRepository, "get">;
	mailbox: Pick<IMailboxRepository, "get">;
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	messageMove: Pick<MessageMoveService, "moveMessages">;
}

export interface MoveToLabelDeps extends MoveMessagesDeps {
	label: Pick<ILabelRepository, "get">;
	labelMailbox: Pick<ILabelMailboxRepository, "get">;
	messageLabel: Pick<IMessageLabelRepository, "apply">;
}

export interface MovedMessages {
	accountId: string;
	destinationMailboxId: string;
}

// The destination must be a folder of the messages' own account that the mail
// server has confirmed: the row records the destination before the move
// settles, so binding to a folder that may never exist leaves the message
// pointing at nothing (imap-mutations R2: wait).
const moveIntoFolder = async (
	deps: MoveMessagesDeps,
	accountConfigId: string,
	messageIds: string[],
	accountId: string,
	destinationMailboxId: string,
): Promise<Refusable<MovedMessages>> => {
	const destination = await deps.mailbox.get(accountId, destinationMailboxId);
	const owned = folderInAccount(destination, accountId, "act");
	if (!owned.ok) return owned;
	const settled = settledFolder(destination);
	if (!settled.ok) return settled;
	await deps.messageMove.moveMessages(
		accountConfigId,
		messageIds,
		destinationMailboxId,
		accountId,
	);
	return accept({ accountId, destinationMailboxId });
};

export const moveMessagesToFolder = async (
	deps: MoveMessagesDeps,
	accountConfigId: string,
	messageIds: string[],
	destinationMailboxId: string,
): Promise<Refusable<MovedMessages>> => {
	const owned = await ownedMessages(deps, messageIds, accountConfigId, "act");
	if (!owned.ok) return owned;
	return moveIntoFolder(
		deps,
		accountConfigId,
		messageIds,
		owned.value,
		destinationMailboxId,
	);
};

// A label is a folder in each account plus a tag on the message, the way a
// label filter files new mail: the move goes to the label's folder in the
// messages' account and the tag follows it.
export const moveMessagesToLabel = async (
	deps: MoveToLabelDeps,
	accountConfigId: string,
	messageIds: string[],
	labelId: string,
): Promise<Refusable<MovedMessages>> => {
	const owned = await ownedMessages(deps, messageIds, accountConfigId, "act");
	if (!owned.ok) return owned;
	const label = await deps.label.get(accountConfigId, labelId);
	const folder = await deps.labelMailbox.get(label.labelId, owned.value);
	if (!folder) {
		return invalid(
			`Label “${label.name}” has no folder in this account yet. Create the label again to add the missing folder`,
		);
	}
	const moved = await moveIntoFolder(
		deps,
		accountConfigId,
		messageIds,
		owned.value,
		folder.mailboxId,
	);
	if (!moved.ok) return moved;
	for (const messageId of messageIds) {
		await deps.messageLabel.apply({ accountConfigId, messageId, labelId });
	}
	return moved;
};
