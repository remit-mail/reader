import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	type AccessMode,
	accept,
	invalid,
	type Refusable,
	refuse,
} from "./refusal.js";

// A read refuses with NotFound so another tenant's account does not leak its
// existence; an action names the resource already, so it is refused outright.
// A deleted account keeps its row until the purge finishes, and is gone to its owner.
export const ownedAccount = <
	A extends Pick<AccountItem, "accountId" | "accountConfigId" | "deletedAt">,
>(
	account: A,
	accountConfigId: string,
	mode: AccessMode,
): Refusable<A> => {
	if (account.accountConfigId === accountConfigId) {
		if (account.deletedAt === undefined) return accept(account);
		return refuse({
			kind: "NotFound",
			message: `Account not found: ${account.accountId}`,
		});
	}
	if (mode === "read") {
		return refuse({
			kind: "NotFound",
			message: `Account not found: ${account.accountId}`,
		});
	}
	return refuse({
		kind: "Forbidden",
		message: `Account ${account.accountId} not in account config`,
	});
};

// Owning the account in a path proves nothing about the mailboxId beside it.
export const folderInAccount = <
	M extends Pick<MailboxItem, "mailboxId" | "accountId">,
>(
	mailbox: M,
	accountId: string,
	mode: AccessMode,
): Refusable<M> => {
	if (mailbox.accountId === accountId) return accept(mailbox);
	if (mode === "read") {
		return refuse({
			kind: "NotFound",
			message: `Mailbox not found: ${mailbox.mailboxId}`,
		});
	}
	return refuse({
		kind: "Forbidden",
		message: `Mailbox ${mailbox.mailboxId} not in account`,
	});
};

const UNSETTLED_REASON: Partial<
	Record<MailboxItem["syncStatus"], (path: string) => string>
> = {
	[MailboxSyncStatus.pending]: (path) =>
		`“${path}” isn’t ready yet — the mail server hasn’t confirmed it.`,
	[MailboxSyncStatus.deleting]: (path) => `“${path}” is being deleted.`,
	[MailboxSyncStatus.failed]: (path) =>
		`The last change to “${path}” failed. Retry or dismiss it first.`,
};

// A durable reference binds only to a folder the mail server has confirmed
// (imap-mutations R2: wait). This is the server-side floor under the client's
// own wait, because a script calling the API directly gets no wait at all.
export const settledFolder = <
	M extends Pick<MailboxItem, "mailboxId" | "fullPath" | "syncStatus">,
>(
	target: M,
): Refusable<M> => {
	const reason = UNSETTLED_REASON[target.syncStatus];
	if (!reason) return accept(target);
	return refuse({
		kind: "NotSettled",
		message: reason(target.fullPath),
		mailboxId: target.mailboxId,
		syncStatus: target.syncStatus,
	});
};

export interface MessageOwnershipClient {
	message: { get(messageId: string): Promise<{ mailboxId: string }> };
	mailbox: {
		get(
			accountId: string,
			mailboxIds: string[],
		): Promise<{ mailboxId: string; accountId: string }[]>;
	};
	account: {
		listAllByAccountConfig(
			accountConfigId: string,
		): Promise<{ accountId: string }[]>;
	};
}

// Messages carry no tenant, so ownership resolves through the caller's own
// accounts: a mailbox resolves only under the account that owns it, and the
// whole batch must land on one account because the downstream services take
// a single accountId.
export const ownedMessages = async (
	client: MessageOwnershipClient,
	messageIds: string[],
	callerAccountConfigId: string,
	mode: AccessMode,
): Promise<Refusable<string>> => {
	const messages = await Promise.all(
		messageIds.map((id) => client.message.get(id)),
	);
	const mailboxIds = [...new Set(messages.map((m) => m.mailboxId))];

	const ownedAccounts = await client.account.listAllByAccountConfig(
		callerAccountConfigId,
	);

	const accountByMailbox = new Map<string, string>();
	for (const { accountId } of ownedAccounts) {
		const rows = await client.mailbox.get(accountId, mailboxIds);
		for (const row of rows) {
			accountByMailbox.set(row.mailboxId, row.accountId);
		}
	}

	if (mailboxIds.some((id) => !accountByMailbox.has(id))) {
		if (mode === "read") {
			return refuse({ kind: "NotFound", message: "Message not found" });
		}
		return refuse({
			kind: "Forbidden",
			message: "Message not in account config",
		});
	}

	const accountIds = [...new Set(accountByMailbox.values())];
	const [accountId] = accountIds;
	if (accountIds.length !== 1 || accountId === undefined) {
		return invalid("All messages must belong to the same account");
	}
	return accept(accountId);
};
