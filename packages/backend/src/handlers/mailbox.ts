import type { MailboxItem } from "@remit/remit-electrodb-service";
import type { MailboxResponse } from "@remit/api-openapi-types";
import { getClient } from "../service/dynamodb.js";
import type {
	MailboxDetailOperationIds,
	MailboxOperationIds,
	OperationHandler,
	TrashOperationIds,
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
	specialUse: mailbox.specialUse ? Array.from(mailbox.specialUse) : undefined,
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

		const mailbox = await getClient().mailboxQueue.createMailbox(
			{
				accountId,
				namespaceType: namespaceType as "personal" | "other_users" | "shared",
				namespacePrefix: "",
				hierarchyDelimiter: "/",
				fullPath,
				uidValidity: 0,
				uidNext: 1,
				highestModseq: 0,
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			},
			accountId,
			true, // subscribe
		);

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

		// Get mailbox to resolve accountId
		const existingMailbox = await getClient().mailbox.get(mailboxId);

		const mailbox = await getClient().mailboxQueue.renameMailbox(
			mailboxId,
			fullPath,
			existingMailbox.accountId,
		);
		return toMailboxResponse(mailbox);
	},

	MailboxDetailOperations_deleteMailbox: async (context) => {
		const { mailboxId } = context.request.params as { mailboxId: string };

		// Get mailbox to resolve accountId
		const mailbox = await getClient().mailbox.get(mailboxId);

		await getClient().mailboxQueue.deleteMailbox(mailboxId, mailbox.accountId);
		return { statusCode: 204 };
	},
};

export const TrashOperations: Record<
	TrashOperationIds,
	OperationHandler<TrashOperationIds>
> = {
	TrashOperations_emptyTrash: async (context) => {
		const { accountId } = context.request.params as { accountId: string };

		const client = getClient();

		// Get trash mailbox to count messages before emptying
		const trashMailbox =
			await client.mailboxSpecialUse.findTrashMailbox(accountId);

		if (!trashMailbox) {
			return { deletedCount: 0 };
		}

		// Get count of messages in trash before emptying
		const messages = await client.message.listAllByMailbox(
			trashMailbox.mailboxId,
		);
		const deletedCount = messages.length;

		// MessageMoveService handles: Message status updates + SQS event
		await client.messageMove.emptyTrash(accountId);

		return { deletedCount };
	},
};
