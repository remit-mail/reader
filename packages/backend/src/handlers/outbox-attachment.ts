import type { MintOutboxAttachmentInput } from "@remit/api-openapi-types";
import type { Context } from "openapi-backend";
import {
	completeOutboxAttachmentFor,
	mintOutboxAttachmentFor,
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
