import type {
	IMailboxRepository,
	IMessageRepository,
	MailboxItem,
	MessageItem,
	RemovedMessage,
} from "@remit/data-ports";
import {
	parseMessageBodyUri,
	type StorageService,
} from "@remit/storage-service";
import pMap from "p-map";

export interface MessageObjectCleanup {
	storage: Pick<StorageService, "deleteMessageObjects">;
	concurrency: number;
}

const deleteStoredObjects = async (
	cleanup: MessageObjectCleanup,
	removed: RemovedMessage[],
): Promise<RemovedMessage[]> => {
	await pMap(
		removed,
		async ({ messageId, bodyStorageKey }) => {
			if (bodyStorageKey === null) return;
			const owner = parseMessageBodyUri(bodyStorageKey);
			if (owner === null) {
				throw new Error(
					`Message ${messageId} was removed, but its body key ${bodyStorageKey} names no message prefix to delete`,
				);
			}
			await cleanup.storage.deleteMessageObjects(
				owner.accountConfigId,
				owner.accountId,
				messageId,
			);
		},
		{ concurrency: cleanup.concurrency },
	);
	return removed;
};

export const messageRepositoryWithObjectCleanup = (
	repository: IMessageRepository,
	cleanup: MessageObjectCleanup,
): IMessageRepository => {
	function get(messageId: string): Promise<MessageItem>;
	function get(messageIds: string[]): Promise<MessageItem[]>;
	function get(
		messageId: string | string[],
	): Promise<MessageItem | MessageItem[]> {
		return Array.isArray(messageId)
			? repository.get(messageId)
			: repository.get(messageId);
	}

	return {
		create: (input) => repository.create(input),
		upsert: (input) => repository.upsert(input),
		upsertWithStatus: (input) => repository.upsertWithStatus(input),
		get,
		update: (messageId, input) => repository.update(messageId, input),
		clearBodyStorageKey: (messageId) =>
			repository.clearBodyStorageKey(messageId),
		clearSpamReport: (messageId) => repository.clearSpamReport(messageId),
		setSearchText: (messageId, text) =>
			repository.setSearchText(messageId, text),
		copySearchText: (sourceMessageId, targetMessageId) =>
			repository.copySearchText(sourceMessageId, targetMessageId),
		syncSearch: (messageIds) => repository.syncSearch(messageIds),
		listMissingSearchText: (after, limit) =>
			repository.listMissingSearchText(after, limit),
		delete: async (messageId) =>
			deleteStoredObjects(cleanup, await repository.delete(messageId)),
		deleteMany: async (messageIds) =>
			deleteStoredObjects(cleanup, await repository.deleteMany(messageIds)),
		deleteIfPlacement: async (messageId, expected) =>
			deleteStoredObjects(
				cleanup,
				await repository.deleteIfPlacement(messageId, expected),
			),
		listByMailbox: (mailboxId, options) =>
			repository.listByMailbox(mailboxId, options),
		listAllByMailbox: (mailboxId) => repository.listAllByMailbox(mailboxId),
		listStrandedPlacements: (mailboxIds, untouchedSince) =>
			repository.listStrandedPlacements(mailboxIds, untouchedSince),
		describe: (messageId) => repository.describe(messageId),
		updateUid: (messageId, newUid, newMailboxId) =>
			repository.updateUid(messageId, newUid, newMailboxId),
		transitionPlacement: (messageId, expected, next) =>
			repository.transitionPlacement(messageId, expected, next),
		repointIfPlacement: (messageId, expected, to) =>
			repository.repointIfPlacement(messageId, expected, to),
	};
};

export const mailboxRepositoryWithObjectCleanup = (
	repository: IMailboxRepository,
	cleanup: MessageObjectCleanup,
): IMailboxRepository => {
	function get(accountId: string, mailboxId: string): Promise<MailboxItem>;
	function get(accountId: string, mailboxIds: string[]): Promise<MailboxItem[]>;
	function get(
		accountId: string,
		mailboxId: string | string[],
	): Promise<MailboxItem | MailboxItem[]> {
		return Array.isArray(mailboxId)
			? repository.get(accountId, mailboxId)
			: repository.get(accountId, mailboxId);
	}

	return {
		create: (input) => repository.create(input),
		get,
		resolveAccountId: (mailboxId) => repository.resolveAccountId(mailboxId),
		update: (accountId, mailboxId, input, remove) =>
			repository.update(accountId, mailboxId, input, remove),
		transition: (accountId, mailboxId, intent) =>
			repository.transition(accountId, mailboxId, intent),
		transitionSubtree: (accountId, mailboxId, intent) =>
			repository.transitionSubtree(accountId, mailboxId, intent),
		delete: (accountId, mailboxId) => repository.delete(accountId, mailboxId),
		deleteMany: (accountId, mailboxIds) =>
			repository.deleteMany(accountId, mailboxIds),
		deleteMailboxWithMail: async (accountId, mailboxId) =>
			deleteStoredObjects(
				cleanup,
				await repository.deleteMailboxWithMail(accountId, mailboxId),
			),
		listByAccount: (accountId, options) =>
			repository.listByAccount(accountId, options),
		listAllByAccount: (accountId) => repository.listAllByAccount(accountId),
		findByPath: (accountId, fullPath) =>
			repository.findByPath(accountId, fullPath),
		getOrCreateByPath: (accountId, fullPath, defaults) =>
			repository.getOrCreateByPath(accountId, fullPath, defaults),
		findByPathPrefix: (accountId, pathPrefix, delimiter) =>
			repository.findByPathPrefix(accountId, pathPrefix, delimiter),
		findBySyncStatus: (accountId, syncStatus) =>
			repository.findBySyncStatus(accountId, syncStatus),
	};
};
