import type { MintOutboxAttachmentInput } from "@remit/api-openapi-types";
import type { Context } from "openapi-backend";
import {
	completeOutboxAttachmentFor,
	mintOutboxAttachmentFor,
	refuseAttachment,
	toOutboxAttachmentResponse,
} from "../service/outbox-operations.js";
import type { HandlerContext } from "../types.js";

export type { OutboxAttachmentRejectionResponse as RejectionResponse } from "../service/outbox-operations.js";
export { toOutboxAttachmentResponse };

export const mintOutboxAttachment = async (
	context: Context,
	ctx: HandlerContext,
) =>
	mintOutboxAttachmentFor(
		ctx.client,
		ctx.identity.accountConfigId,
		(context.request.params as { outboxMessageId: string }).outboxMessageId,
		context.request.requestBody as MintOutboxAttachmentInput,
	);

export const renewOutboxAttachment = async (
	context: Context,
	ctx: HandlerContext,
) => {
	const { outboxMessageId, outboxAttachmentId } = context.request.params as {
		outboxMessageId: string;
		outboxAttachmentId: string;
	};
	const result = await ctx.client.outboxAttachment.renew({
		accountConfigId: ctx.identity.accountConfigId,
		outboxMessageId,
		outboxAttachmentId,
	});
	return result.outcome === "Rejected"
		? refuseAttachment(result.rejection)
		: result.reservation;
};

export const completeOutboxAttachment = async (
	context: Context,
	ctx: HandlerContext,
) => {
	const { outboxMessageId, outboxAttachmentId } = context.request.params as {
		outboxMessageId: string;
		outboxAttachmentId: string;
	};
	return completeOutboxAttachmentFor(
		ctx.client,
		ctx.config,
		ctx.identity.accountConfigId,
		outboxMessageId,
		outboxAttachmentId,
	);
};
