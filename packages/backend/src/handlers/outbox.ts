import type {
	CreateOutboxMessageInput,
	UpdateOutboxMessageInput,
} from "@remit/api-openapi-types";
import type { Context } from "openapi-backend";
import {
	createOutboxMessageFor,
	deleteOutboxMessageFor,
	getOutboxMessageFor,
	listOutboxMessagesFor,
	sendOutboxMessageFor,
	updateOutboxMessageFor,
} from "../service/outbox-operations.js";
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
	renewOutboxAttachment,
} from "./outbox-attachment.js";

export const OutboxOperations = {
	OutboxOperations_createOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	) =>
		createOutboxMessageFor(
			ctx.client,
			ctx.config,
			ctx.identity.accountConfigId,
			context.request.requestBody as CreateOutboxMessageInput,
		),

	OutboxOperations_listOutboxMessages: async (
		context: Context,
		ctx: HandlerContext,
	) =>
		listOutboxMessagesFor(
			ctx.client,
			ctx.config,
			ctx.identity.accountConfigId,
			(context.request.query as { continuationToken?: string })
				.continuationToken,
		),
} satisfies Record<
	OutboxOperationIds,
	OperationHandler<OutboxOperationIds, QueueName>
>;

export const OutboxDetailOperations = {
	OutboxDetailOperations_getOutboxMessage: async (
		context: Context,
		ctx: HandlerContext,
	) =>
		getOutboxMessageFor(
			ctx.client,
			ctx.config,
			ctx.identity.accountConfigId,
			(context.request.params as { outboxMessageId: string }).outboxMessageId,
		),

	OutboxDetailOperations_updateOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	) =>
		updateOutboxMessageFor(
			ctx.client,
			ctx.config,
			ctx.identity.accountConfigId,
			(context.request.params as { outboxMessageId: string }).outboxMessageId,
			context.request.requestBody as UpdateOutboxMessageInput,
		),

	OutboxDetailOperations_deleteOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	) => {
		await deleteOutboxMessageFor(
			ctx.client,
			ctx.identity.accountConfigId,
			(context.request.params as { outboxMessageId: string }).outboxMessageId,
		);
		return { statusCode: 204 };
	},

	OutboxDetailOperations_sendOutboxMessage: async (
		context: Context,
		ctx: HandlerContext<"smtp">,
	) =>
		sendOutboxMessageFor(
			ctx.client,
			ctx.config,
			ctx.identity.accountConfigId,
			(context.request.params as { outboxMessageId: string }).outboxMessageId,
		),

	OutboxDetailOperations_mintOutboxAttachment: mintOutboxAttachment,
} satisfies Record<
	OutboxDetailOperationIds,
	OperationHandler<OutboxDetailOperationIds, QueueName>
>;

export const OutboxAttachmentOperations = {
	OutboxAttachmentOperations_renewOutboxAttachment: renewOutboxAttachment,
	OutboxAttachmentOperations_completeOutboxAttachment: completeOutboxAttachment,
} satisfies Record<
	OutboxAttachmentOperationIds,
	OperationHandler<OutboxAttachmentOperationIds, QueueName>
>;
