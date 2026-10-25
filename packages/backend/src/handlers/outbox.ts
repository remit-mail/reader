import type {
	CreateOutboxMessageInput,
	OutboxMessageResponse,
	UpdateOutboxMessageInput,
} from "@remit/api-openapi-types";
import type {
	OutboxAttachmentItem,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import type { Context } from "openapi-backend";
import type { ApiConfig } from "../config/api-config.js";
import type { QueueName } from "../service/queues.js";
import type {
	HandlerContext,
	OperationHandler,
	OutboxAttachmentOperationIds,
	OutboxDetailOperationIds,
	OutboxOperationIds,
} from "../types.js";
import {
	completeOutboxAttachment,
	mintOutboxAttachment,
	toOutboxAttachmentResponse,
} from "./outbox-attachment.js";

const toOutboxMessageResponse = (
	config: ApiConfig,
	item: OutboxMessageItem,
	attachments: OutboxAttachmentItem[] = [],
): OutboxMessageResponse => ({
	attachments: attachments.map(toOutboxAttachmentResponse(config)),
	outboxMessageId: item.outboxMessageId,
	accountId: item.accountId,
	fromAddress: item.fromAddress,
	fromName: item.fromName,
	toAddresses: item.toAddresses,
	ccAddresses: item.ccAddresses ?? [],
	bccAddresses: item.bccAddresses ?? [],
	subject: item.subject,
	textBody: item.textBody,
	htmlBody: item.htmlBody,
	inReplyTo: item.inReplyTo,
	references: item.references ?? [],
	status: item.status,
	lastError: item.lastError,
	sentAt: item.sentAt,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

export const OutboxOperations = {
	OutboxOperations_createOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	): Promise<OutboxMessageResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const input = context.request.requestBody as CreateOutboxMessageInput;

		const client = ctx.client;

		const account = await client.account.get(input.accountId);
		if (account.accountConfigId !== accountConfigId) {
			throw new ForbiddenError(
				`Account ${input.accountId} not in account config`,
			);
		}

		const fromAddress = account.email;

		if (input.sendImmediately) {
			const outbox = await client.outboxQueue.createAndSend({
				accountId: input.accountId,
				accountConfigId,
				fromAddress,

				toAddresses: input.toAddresses,
				ccAddresses: input.ccAddresses,
				bccAddresses: input.bccAddresses,
				subject: input.subject,
				textBody: input.textBody,
				htmlBody: input.htmlBody,
				inReplyTo: input.inReplyTo,
				references: input.references,
			});
			return toOutboxMessageResponse(ctx.config, outbox);
		}

		const outbox = await client.outboxQueue.createDraft({
			accountId: input.accountId,
			accountConfigId,
			fromAddress,

			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
		});
		return toOutboxMessageResponse(ctx.config, outbox);
	},

	OutboxOperations_listOutboxMessages: async (
		context: Context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = ctx.client;

		const accounts =
			await client.account.listAllByAccountConfig(accountConfigId);
		if (accounts.length === 0) {
			return { items: [], continuationToken: null };
		}

		const result = await client.outboxMessage.listByAccounts(
			accounts.map((account) => account.accountId),
			{ continuationToken },
		);

		return {
			items: result.items.map((item) =>
				toOutboxMessageResponse(ctx.config, item),
			),
			continuationToken: result.continuationToken,
		};
	},
} satisfies Record<
	OutboxOperationIds,
	OperationHandler<OutboxOperationIds, QueueName>
>;

export const OutboxDetailOperations = {
	OutboxDetailOperations_getOutboxMessage: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<OutboxMessageResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = ctx.client;
		// Default mode "read": the scoped get refuses a foreign message with
		// NotFound (404, no existence leak) — no separate check needed.
		const outbox = await client.outboxMessage.get(
			accountConfigId,
			outboxMessageId,
		);
		return toOutboxMessageResponse(
			ctx.config,
			outbox,
			await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
		);
	},

	OutboxDetailOperations_updateOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	): Promise<OutboxMessageResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};
		const input = context.request.requestBody as UpdateOutboxMessageInput;

		const client = ctx.client;
		// updateDraft's own scoped get uses mode "act": a foreign message is
		// denied with Forbidden (403), not feigned as NotFound.
		const updated = await client.outboxQueue.updateDraft(
			accountConfigId,
			outboxMessageId,
			{
				toAddresses: input.toAddresses,
				ccAddresses: input.ccAddresses,
				bccAddresses: input.bccAddresses,
				subject: input.subject,
				textBody: input.textBody,
				htmlBody: input.htmlBody,
				inReplyTo: input.inReplyTo,
				references: input.references,
			},
		);

		// Absent means "leave the files alone" — a body that only carries a subject
		// must not strip them. Present states exactly what the draft keeps, so an
		// empty list is a real instruction to remove them all.
		if (input.attachmentIds !== undefined) {
			await client.outboxAttachment.retainOnly(
				accountConfigId,
				updated.accountId,
				outboxMessageId,
				input.attachmentIds,
			);
		}

		return toOutboxMessageResponse(
			ctx.config,
			updated,
			await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
		);
	},

	OutboxDetailOperations_deleteOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = ctx.client;
		// deleteDraft's own scoped get uses mode "act": a foreign message is
		// denied with Forbidden (403), not feigned as NotFound.
		await client.outboxQueue.deleteDraft(accountConfigId, outboxMessageId);
		return { statusCode: 204 };
	},

	OutboxDetailOperations_sendOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	): Promise<OutboxMessageResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = ctx.client;
		// send's own scoped get uses mode "act": a foreign message is denied
		// with Forbidden (403), not feigned as NotFound.
		const sent = await client.outboxQueue.send(
			accountConfigId,
			outboxMessageId,
		);
		return toOutboxMessageResponse(ctx.config, sent);
	},

	OutboxDetailOperations_mintOutboxAttachment: mintOutboxAttachment,
} satisfies Record<
	OutboxDetailOperationIds,
	OperationHandler<OutboxDetailOperationIds, QueueName>
>;

export const OutboxAttachmentOperations = {
	OutboxAttachmentOperations_completeOutboxAttachment: completeOutboxAttachment,
} satisfies Record<
	OutboxAttachmentOperationIds,
	OperationHandler<OutboxAttachmentOperationIds, QueueName>
>;
