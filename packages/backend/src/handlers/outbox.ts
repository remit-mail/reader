import {
	ForbiddenError,
	type OutboxMessageItem,
} from "@remit/remit-electrodb-service";
import type {
	CreateOutboxMessageInput,
	OutboxMessageResponse,
	UpdateOutboxMessageInput,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type {
	OperationHandler,
	OutboxDetailOperationIds,
	OutboxOperationIds,
} from "../types.js";

const toOutboxMessageResponse = (
	item: OutboxMessageItem,
): OutboxMessageResponse => ({
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
	OperationHandler<OutboxOperationIds>
> = {
	OutboxOperations_createOutboxMessage: async (
		_context: Context,
		...args: unknown[]
	): Promise<OutboxMessageResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const input = JSON.parse(event.body ?? "{}") as CreateOutboxMessageInput;

		const client = await getClient();

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
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = await getClient();

		const accounts = await client.account.list(accountConfigId);
		if (accounts.items.length === 0) {
			return { items: [], continuationToken: null };
		}

		const accountId = accounts.items[0].accountId;
		const result = await client.outboxMessage.listByAccount(accountId, {
			continuationToken,
		});

		return {
			items: result.items.map(toOutboxMessageResponse),
			continuationToken: result.continuationToken,
		};
	},
};

export const OutboxDetailOperations: Record<
	OutboxDetailOperationIds,
	OperationHandler<OutboxDetailOperationIds>
> = {
	OutboxDetailOperations_getOutboxMessage: async (
		context: Context,
		...args: unknown[]
	): Promise<OutboxMessageResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = await getClient();
		// Default mode "read": the scoped get refuses a foreign message with
		// NotFound (404, no existence leak) — no separate check needed.
		const outbox = await client.outboxMessage.get(
			accountConfigId,
			outboxMessageId,
		);
		return toOutboxMessageResponse(outbox);
	},

	OutboxDetailOperations_updateOutboxMessage: async (
		context: Context,
		...args: unknown[]
	): Promise<OutboxMessageResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};
		const input = context.request.requestBody as UpdateOutboxMessageInput;

		const client = await getClient();
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
		return toOutboxMessageResponse(updated);
	},

	OutboxDetailOperations_deleteOutboxMessage: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = await getClient();
		// deleteDraft's own scoped get uses mode "act": a foreign message is
		// denied with Forbidden (403), not feigned as NotFound.
		await client.outboxQueue.deleteDraft(accountConfigId, outboxMessageId);
		return { statusCode: 204 };
	},

	OutboxDetailOperations_sendOutboxMessage: async (
		context: Context,
		...args: unknown[]
	): Promise<OutboxMessageResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { outboxMessageId } = context.request.params as {
			outboxMessageId: string;
		};

		const client = await getClient();
		// send's own scoped get uses mode "act": a foreign message is denied
		// with Forbidden (403), not feigned as NotFound.
		const sent = await client.outboxQueue.send(
			accountConfigId,
			outboxMessageId,
		);
		return toOutboxMessageResponse(sent);
	},
};
