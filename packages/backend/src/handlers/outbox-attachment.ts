import type {
	MintOutboxAttachmentInput,
	MintOutboxAttachmentResponse,
	OutboxAttachmentRejection,
	OutboxAttachmentResponse,
} from "@remit/api-openapi-types";
import { OutboxAttachmentRejectionReason } from "@remit/domain-enums";
import type {
	OutboxAttachmentRejectionDetail,
	OutboxAttachmentRejectionReasonValue,
} from "@remit/mailbox-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/data-client.js";

const TOO_LARGE: ReadonlySet<OutboxAttachmentRejectionReasonValue> = new Set([
	OutboxAttachmentRejectionReason.FileTooLarge,
	OutboxAttachmentRejectionReason.MessageTooLarge,
	OutboxAttachmentRejectionReason.TooManyAttachments,
]);

interface RejectionResponse {
	statusCode: number;
	body: OutboxAttachmentRejection;
}

const refuse = (
	detail: OutboxAttachmentRejectionDetail,
): RejectionResponse => ({
	statusCode: TOO_LARGE.has(detail.reason) ? 413 : 400,
	body: {
		reason: detail.reason,
		message: detail.message,
		limitBytes: detail.limitBytes,
		usedBytes: detail.usedBytes,
	},
});

/**
 * Reserve room on a draft and hand back somewhere to put the bytes. Small JSON
 * in, small JSON out — the file itself never passes through here, which is what
 * lets the upload live on its own fleet and keeps this operation under any
 * payload ceiling the REST tier has.
 */
export const mintOutboxAttachment = async (
	context: Context,
	...args: unknown[]
): Promise<MintOutboxAttachmentResponse | RejectionResponse> => {
	const event = args[0] as APIGatewayProxyEvent;
	const accountConfigId = getAccountConfigIdFromEvent(event);
	const { outboxMessageId } = context.request.params as {
		outboxMessageId: string;
	};
	const input = context.request.requestBody as MintOutboxAttachmentInput;

	const client = await getClient();
	const result = await client.outboxAttachment.mint({
		accountConfigId,
		outboxMessageId,
		filename: input.filename,
		contentType: input.contentType,
		sizeBytes: input.sizeBytes,
	});

	if (result.outcome === "Rejected") return refuse(result.rejection);

	return result.reservation;
};

/**
 * Confirm the upload landed. The size in the response is read back from
 * storage — on a deployment where the browser PUT straight to block storage
 * this call is the first the API hears of the bytes, and the client's word for
 * how many there are is not evidence.
 */
export const completeOutboxAttachment = async (
	context: Context,
	...args: unknown[]
): Promise<OutboxAttachmentResponse | RejectionResponse> => {
	const event = args[0] as APIGatewayProxyEvent;
	const accountConfigId = getAccountConfigIdFromEvent(event);
	const { outboxMessageId, outboxAttachmentId } = context.request.params as {
		outboxMessageId: string;
		outboxAttachmentId: string;
	};
	const client = await getClient();
	const result = await client.outboxAttachment.complete({
		accountConfigId,
		outboxMessageId,
		outboxAttachmentId,
	});

	if (result.outcome === "Rejected") return refuse(result.rejection);

	return result.attachment;
};
