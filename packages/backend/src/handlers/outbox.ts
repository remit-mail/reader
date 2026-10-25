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

type OutboxContext = HandlerContext<"smtp">;

const toOutboxMessageResponse = (
	item: OutboxMessageItem,
	attachments: OutboxAttachmentItem[] = [],
): OutboxMessageResponse => ({
	attachments: attachments.map(toOutboxAttachmentResponse),
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

export const OutboxOperations: Record<
	OutboxOperationIds,
	OperationHandler<OutboxOperationIds, "smtp">
> = {
	OutboxOperations_createOutboxMessage: async (
		context: Context,
		ctx: OutboxContext,
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
			return toOutboxMessageResponse(outbox);
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
		return toOutboxMessageResponse(outbox);
	},

	OutboxOperations_listOutboxMessages: async (
		context: Context,
		ctx: OutboxContext,
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
			items: result.items.map((item) => toOutboxMessageResponse(item)),
			continuationToken: result.continuationToken,
		};
	},
};

export const OutboxDetailOperations: Record<
	OutboxDetailOperationIds,
	OperationHandler<OutboxDetailOperationIds, "smtp">
> = {
	OutboxDetailOperations_getOutboxMessage: async (
		context: Context,
		ctx: OutboxContext,
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
			outbox,
			await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
		);
	},

	OutboxDetailOperations_updateOutboxMessage: async (
		context: Context,
		ctx: OutboxContext,
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
			updated,
			await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
		);
	},

	OutboxDetailOperations_deleteOutboxMessage: async (
		context: Context,
		ctx: OutboxContext,
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
		ctx: OutboxContext,
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
		return toOutboxMessageResponse(sent);
	},

	OutboxDetailOperations_mintOutboxAttachment: mintOutboxAttachment,
};

export const OutboxAttachmentOperations: Record<
	OutboxAttachmentOperationIds,
	OperationHandler<OutboxAttachmentOperationIds, "smtp">
> = {
	OutboxAttachmentOperations_completeOutboxAttachment: completeOutboxAttachment,
};
