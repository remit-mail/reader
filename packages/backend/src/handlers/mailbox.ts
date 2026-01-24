import type { MailboxItem } from "@remit/remit-electrodb-service";
import type { MailboxResponse } from "@remit/api-openapi-types";
import { getClient } from "../service/dynamodb.js";
import type {
	MailboxDetailOperationIds,
	MailboxOperationIds,
	OperationHandler,
} from "../types.js";

const toMailboxResponse = (mailbox: MailboxItem): MailboxResponse => ({
	mailboxId: mailbox.mailboxId,
	accountId: mailbox.accountId,
	namespaceType: mailbox.namespaceType,
	namespacePrefix: mailbox.namespacePrefix,
	hierarchyDelimiter: mailbox.hierarchyDelimiter,
	fullPath: mailbox.fullPath,
	messageCount: mailbox.messageCount,
	unseenCount: mailbox.unseenCount,
	deletedCount: mailbox.deletedCount,
	createdAt: mailbox.createdAt,
	updatedAt: mailbox.updatedAt,
});

export const MailboxOperations: Record<
	MailboxOperationIds,
	OperationHandler<MailboxOperationIds>
> = {
	MailboxOperations_listMailboxes: async (context) => {
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};
		const result = await getClient().mailbox.listByAccount(accountId, {
			continuationToken,
		});
		return {
			items: result.items.map(toMailboxResponse),
			continuationToken: result.continuationToken,
		};
	},

	MailboxOperations_createMailbox: async (context) => {
		const { accountId } = context.request.params as { accountId: string };
		const { namespaceType, fullPath } = context.request.requestBody as {
			namespaceType: string;
			fullPath: string;
		};

		const mailbox = await getClient().mailbox.create({
			accountId,
			namespaceType: namespaceType as "personal" | "other_users" | "shared",
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath,
			uidValidity: 0,
			uidNext: 1,
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			syncStatus: "pending",
		});

		return toMailboxResponse(mailbox);
	},
};

export const MailboxDetailOperations: Record<
	MailboxDetailOperationIds,
	OperationHandler<MailboxDetailOperationIds>
> = {
	MailboxDetailOperations_getMailbox: async (context) => {
		const { mailboxId } = context.request.params as { mailboxId: string };
		const mailbox = await getClient().mailbox.get(mailboxId);
		return toMailboxResponse(mailbox);
	},

	MailboxDetailOperations_renameMailbox: async (context) => {
		const { mailboxId } = context.request.params as { mailboxId: string };
		const { fullPath } = context.request.requestBody as { fullPath?: string };

		if (!fullPath) {
			const mailbox = await getClient().mailbox.get(mailboxId);
			return toMailboxResponse(mailbox);
		}

		const mailbox = await getClient().mailbox.update(mailboxId, {
			fullPath,
			syncStatus: "pending",
		});
		return toMailboxResponse(mailbox);
	},

	MailboxDetailOperations_deleteMailbox: async (context) => {
		const { mailboxId } = context.request.params as { mailboxId: string };
		await getClient().mailbox.update(mailboxId, { syncStatus: "deleting" });
		return { statusCode: 204 };
	},
};
