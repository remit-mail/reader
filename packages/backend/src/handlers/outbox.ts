import {
	ForbiddenError,
	NotFoundError,
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

/**
 * Cross-tenant ownership guard for outbox messages.
 *
 * `mode: "read"` throws NotFoundError on mismatch (404) so we don't leak the
 * existence of another tenant's resource on a GET. `mode: "act"` throws
 * ForbiddenError on mismatch (403) for action verbs (PATCH/POST/DELETE) where
 * the caller has already named the resource and the API contract says we
 * explicitly deny rather than feign 404.
 */
export const assertOutboxOwnership = (
	message: Pick<OutboxMessageItem, "outboxMessageId" | "accountConfigId">,
	callerAccountConfigId: string,
	mode: "read" | "act",
): void => {
	if (message.accountConfigId === callerAccountConfigId) return;
	if (mode === "read") {
		throw new NotFoundError(
			`OutboxMessage not found: ${message.outboxMessageId}`,
		);
	}
	throw new ForbiddenError(
		`OutboxMessage ${message.outboxMessageId} not in account config`,
	);
};

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

		const client = getClient();

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

		const client = getClient();

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

		const client = getClient();
		const outbox = await client.outboxMessage.get(outboxMessageId);
		assertOutboxOwnership(outbox, accountConfigId, "read");
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

		const client = getClient();
		const existing = await client.outboxMessage.get(outboxMessageId);
		assertOutboxOwnership(existing, accountConfigId, "act");

		const updated = await client.outboxQueue.updateDraft(outboxMessageId, {
			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
		});
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

		const client = getClient();
		const existing = await client.outboxMessage.get(outboxMessageId);
		assertOutboxOwnership(existing, accountConfigId, "act");

		await client.outboxQueue.deleteDraft(outboxMessageId);
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

		const client = getClient();
		const existing = await client.outboxMessage.get(outboxMessageId);
		assertOutboxOwnership(existing, accountConfigId, "act");

		const sent = await client.outboxQueue.send(outboxMessageId);
		return toOutboxMessageResponse(sent);
	},
};
