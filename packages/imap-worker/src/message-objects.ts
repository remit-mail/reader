import type {
	IAccountRepository,
	IMailboxRepository,
	IMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import { buildMessageObjectPrefix } from "@remit/storage-service";
import pMap from "p-map";
import type { AccountObjectStore, ProcessContext } from "./context.js";

interface MessageObjectDeps {
	objects: AccountObjectStore;
	account: Pick<IAccountRepository, "get">;
	mailbox: Pick<IMailboxRepository, "resolveAccountId">;
	message: Pick<IMessageRepository, "listByMailbox">;
	concurrency: number;
}

const deleteUnder = async (
	objects: AccountObjectStore,
	prefix: string,
	continuationToken?: string,
): Promise<void> => {
	const page = await objects.list(prefix, continuationToken);
	if (page.keys.length > 0) await objects.delete(page.keys);
	if (page.nextContinuationToken === undefined) return;
	await deleteUnder(objects, prefix, page.nextContinuationToken);
};

const deleteAccountMessageObjects = async (
	deps: MessageObjectDeps,
	accountId: string,
	rows: readonly MessageItem[],
): Promise<void> => {
	const stored = rows.filter((row) => row.bodyStorageKey !== undefined);
	if (stored.length === 0) return;
	const { accountConfigId } = await deps.account.get(accountId);
	await pMap(
		stored,
		(row) =>
			deleteUnder(
				deps.objects,
				buildMessageObjectPrefix(accountConfigId, accountId, row.messageId),
			),
		{ concurrency: deps.concurrency },
	);
};

const deleteMessageObjects = async (
	deps: MessageObjectDeps,
	rows: readonly MessageItem[],
): Promise<void> => {
	const mailboxIds = [...new Set(rows.map((row) => row.mailboxId))];
	for (const mailboxId of mailboxIds) {
		const accountId = await deps.mailbox.resolveAccountId(mailboxId);
		if (accountId === null) continue;
		await deleteAccountMessageObjects(
			deps,
			accountId,
			rows.filter((row) => row.mailboxId === mailboxId),
		);
	}
};

const deleteMailboxObjects = async (
	deps: MessageObjectDeps,
	accountId: string,
	mailboxId: string,
	continuationToken?: string,
): Promise<void> => {
	const page = await deps.message.listByMailbox(mailboxId, {
		continuationToken,
	});
	await deleteAccountMessageObjects(deps, accountId, page.items);
	if (page.continuationToken === undefined) return;
	await deleteMailboxObjects(
		deps,
		accountId,
		mailboxId,
		page.continuationToken,
	);
};

const overriding = <T extends object>(target: T, overrides: Partial<T>): T =>
	new Proxy(target, {
		get: (inner, key) => {
			if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
			const value = Reflect.get(inner, key);
			return typeof value === "function" ? value.bind(inner) : value;
		},
	});

const cleanClient = (ctx: ProcessContext): ProcessContext["client"] => {
	const { client, accountObjects, config } = ctx;
	const { message, mailbox } = client;
	const deps: MessageObjectDeps = {
		objects: accountObjects,
		account: client.account,
		mailbox,
		message,
		concurrency: config.messageObjectDeleteConcurrency,
	};

	const cleanMessage = overriding<IMessageRepository>(message, {
		delete: async (messageId) => {
			await deleteMessageObjects(deps, await message.get([messageId]));
			await message.delete(messageId);
		},
		deleteMany: async (messageIds) => {
			await deleteMessageObjects(deps, await message.get(messageIds));
			await message.deleteMany(messageIds);
		},
		deleteIfPlacement: async (messageId, expected) => {
			const rows = await message.get([messageId]);
			const removed = await message.deleteIfPlacement(messageId, expected);
			if (removed) await deleteMessageObjects(deps, rows);
			return removed;
		},
	});

	const cleanMailbox = overriding<IMailboxRepository>(mailbox, {
		deleteMailboxWithMail: async (accountId, mailboxId) => {
			if ((await mailbox.resolveAccountId(mailboxId)) === accountId) {
				await deleteMailboxObjects(deps, accountId, mailboxId);
			}
			await mailbox.deleteMailboxWithMail(accountId, mailboxId);
		},
	});

	return { ...client, message: cleanMessage, mailbox: cleanMailbox };
};

export const withMessageObjectCleanup = (
	ctx: ProcessContext,
): ProcessContext => {
	let client: ProcessContext["client"] | undefined;
	return {
		...ctx,
		get client() {
			client ??= cleanClient(ctx);
			return client;
		},
	};
};
