import type {
	BulkMessageInput,
	BulkUpdateFlagsInput,
	RawMessageResponse,
	UpdateFlagsInput,
	UpdateMessageLabelsInput,
} from "@remit/api-openapi-types";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import type { StarColor } from "@remit/domain-enums";
import { logger } from "@remit/logger";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	MailboxCursorPausedError,
	type NeverSpamGrant,
	NoJunkMailboxError,
	ownedAccount,
	ownedMessages,
	resolveFolderPlacement,
} from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";
import { requestNeverSpamBackApply } from "./never-spam.js";
import { unwrap } from "./refusal.js";

type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

export const emptyTrashFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	accountId: string,
) => {
	unwrap(
		ownedAccount(await client.account.get(accountId), accountConfigId, "act"),
	);
	return client.messageMove.emptyTrash(accountConfigId, accountId);
};

export const getRawMessageFor = async (
	client: RemitClient<"sync" | "messageManagement">,
	accountConfigId: string,
	messageId: string,
): Promise<RawMessageResponse> => {
	const accountId = unwrap(
		await ownedMessages(client, [messageId], accountConfigId, "read"),
	);
	const message = await client.message.get(messageId);
	if (!message.bodyStorageKey) {
		const mailbox = await client.mailbox.get(accountId, message.mailboxId);
		if (isCursorRebuildNeeded(mailbox.cursorState)) {
			logger.debug(
				{
					accountId,
					mailboxId: mailbox.mailboxId,
					messageId,
					cursorState: mailbox.cursorState,
				},
				"Mailbox cursor not normal; skipping IMAP body backfill for this request",
			);
		} else {
			const folder = {
				mailboxId: mailbox.mailboxId,
				fullPath: mailbox.fullPath,
				initialSyncCompletedAt: mailbox.initialSyncCompletedAt,
				createdAt: mailbox.createdAt,
				placement: await resolveFolderPlacement(
					client.mailboxSpecialUse,
					accountId,
					mailbox.mailboxId,
				),
			};
			const scope = await client.createConnectionScope(accountId);
			const connection = guardConnectionCursor(
				await scope.getConnection(),
				{ mailboxService: client.mailbox },
				accountId,
				mailbox,
			);
			await client.bodySync
				.fetchAndGetBody(messageId, accountId, accountConfigId, folder, () =>
					Promise.resolve(connection),
				)
				.catch((error: unknown) => {
					if (!(error instanceof MailboxCursorPausedError)) throw error;
					logger.debug(
						{
							accountId,
							mailboxId: mailbox.mailboxId,
							messageId,
							cursorState: error.state,
						},
						"Mailbox cursor not normal; skipping IMAP body backfill for this request",
					);
				})
				.finally(() => scope.disconnect());
		}
	}
	const stored = await client.message.get(messageId);
	if (!stored.bodyStorageKey) {
		throw new Error(
			`Raw source unavailable for message ${messageId}: no bodyStorageKey after backfill`,
		);
	}
	return {
		raw: (await client.storage.retrieve(stored.bodyStorageKey)).toString(
			"latin1",
		),
	};
};

export const updateMessageFlagsFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	messageId: string,
	input: UpdateFlagsInput,
) => {
	const accountId = unwrap(
		await ownedMessages(client, [messageId], accountConfigId, "act"),
	);
	const result = await client.flagQueue.updateFlags(
		accountConfigId,
		messageId,
		accountId,
		{
			isRead: input.isRead,
			isStarred: input.isStarred,
			starColor: input.starColor as StarColorValue | undefined,
		},
	);
	return {
		messageId: result.messageId,
		isRead: result.isRead,
		isStarred: result.isStarred,
	};
};

export const updateFlagsFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	input: BulkUpdateFlagsInput,
) => {
	if (input.messageIds.length === 0) {
		return { successCount: 0, failureCount: 0 };
	}
	const accountId = unwrap(
		await ownedMessages(client, input.messageIds, accountConfigId, "act"),
	);
	for (const messageId of input.messageIds) {
		await client.flagQueue.updateFlags(accountConfigId, messageId, accountId, {
			isRead: input.isRead,
			isStarred: input.isStarred,
			starColor: input.starColor as StarColorValue | undefined,
		});
	}
	return { successCount: input.messageIds.length, failureCount: 0 };
};

export const updateMessageLabelsFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	input: UpdateMessageLabelsInput,
) => {
	if (input.messageIds.length === 0) {
		return { successCount: 0, failureCount: 0 };
	}
	unwrap(await ownedMessages(client, input.messageIds, accountConfigId, "act"));
	await client.label.get(accountConfigId, input.labelId);
	for (const messageId of input.messageIds) {
		if (input.action === "Apply") {
			await client.messageLabel.apply({
				accountConfigId,
				messageId,
				labelId: input.labelId,
			});
		} else {
			await client.messageLabel.remove(messageId, input.labelId);
		}
	}
	return { successCount: input.messageIds.length, failureCount: 0 };
};

export interface SpamReportBulkFailure {
	messageId: string;
	reason: string;
}

export interface SpamReportBulkOutcome {
	successCount: number;
	failureCount: number;
	failures?: SpamReportBulkFailure[];
}

export const GENERIC_FAILURE_REASON =
	"This message could not be processed. Please try again. If it keeps failing, report it.";

const failureReason = (reason: unknown): string => {
	if (reason instanceof MessagePlacementUnsettledError) {
		return "This message is still being moved on the mail server. Try again in a moment.";
	}
	if (reason instanceof NoJunkMailboxError) return reason.message;
	return GENERIC_FAILURE_REASON;
};

export const settleSpamReportBulk = async (
	messageIds: string[],
	run: (messageId: string) => Promise<void>,
): Promise<SpamReportBulkOutcome> => {
	const results = await Promise.allSettled(messageIds.map(run));
	let successCount = 0;
	const failures: SpamReportBulkFailure[] = [];
	results.forEach((result, index) => {
		if (result.status === "fulfilled") {
			successCount += 1;
			return;
		}
		const messageId = messageIds[index];
		failures.push({ messageId, reason: failureReason(result.reason) });
		logger.error(
			{ messageId, error: result.reason },
			"spam-report bulk operation failed for one message",
		);
	});
	return {
		successCount,
		failureCount: failures.length,
		...(failures.length > 0 ? { failures } : {}),
	};
};

export const reportSpamFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	setBy: string,
	input: BulkMessageInput,
) => {
	const messageIds = [...new Set(input.messageIds)];
	if (messageIds.length === 0) return { successCount: 0, failureCount: 0 };
	const accountId = unwrap(
		await ownedMessages(client, messageIds, accountConfigId, "act"),
	);
	return settleSpamReportBulk(messageIds, (messageId) =>
		client.spamReport.reportSpam({
			accountConfigId,
			accountId,
			messageId,
			setBy,
		}),
	);
};

export const notSpamFor = async (
	client: RemitClient<"sync" | "accountFanout">,
	accountConfigId: string,
	setBy: string,
	input: BulkMessageInput,
) => {
	const messageIds = [...new Set(input.messageIds)];
	if (messageIds.length === 0) return { successCount: 0, failureCount: 0 };
	const accountId = unwrap(
		await ownedMessages(client, messageIds, accountConfigId, "act"),
	);
	const grants = new Map<string, NeverSpamGrant>();
	const outcome = await settleSpamReportBulk(messageIds, async (messageId) => {
		const grant = await client.spamReport.notSpam({
			accountConfigId,
			accountId,
			messageId,
			setBy,
		});
		if (grant) grants.set(grant.addressId, grant);
	});
	const unstarted: { grant: NeverSpamGrant; cause: unknown }[] = [];
	await Promise.all(
		[...grants.values()].map((grant) =>
			requestNeverSpamBackApply(client.queues.accountFanout, grant).catch(
				(cause: unknown) => unstarted.push({ grant, cause }),
			),
		),
	);
	if (unstarted.length > 0) {
		const senders = unstarted
			.map(({ grant }) => grant.normalizedEmail)
			.join(", ");
		throw new Error(
			`Never spam is saved for ${senders}, but their other mail in Spam did not move. Press Not spam again, or turn never spam on from the sender's settings, to retry.`,
			{ cause: unstarted.map(({ cause }) => cause) },
		);
	}
	return outcome;
};
