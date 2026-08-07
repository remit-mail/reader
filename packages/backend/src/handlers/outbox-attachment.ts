import type {
	OutboxAttachmentRejection,
	OutboxAttachmentResponse,
} from "@remit/api-openapi-types";
import { OutboxAttachmentRejectionReason } from "@remit/domain-enums";
import {
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	type OutboxAttachmentRejectionDetail,
	type OutboxAttachmentRejectionReasonValue,
} from "@remit/mailbox-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { readUploadedFile } from "../multipart.js";
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

const refuseBody = (
	reason: OutboxAttachmentRejectionReasonValue,
	message: string,
): RejectionResponse =>
	refuse({
		reason,
		message,
		limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
		usedBytes: 0,
	});

export const uploadOutboxAttachment = async (
	context: Context,
	...args: unknown[]
): Promise<OutboxAttachmentResponse | RejectionResponse> => {
	const event = args[0] as APIGatewayProxyEvent;
	const accountConfigId = getAccountConfigIdFromEvent(event);
	const { outboxMessageId } = context.request.params as {
		outboxMessageId: string;
	};

	const upload = await readUploadedFile(event, "file");
	if (upload.outcome === "Malformed") {
		return refuseBody(
			OutboxAttachmentRejectionReason.MalformedUpload,
			"The upload could not be read as a multipart form. Try attaching the file again.",
		);
	}
	if (upload.outcome === "NoSuchPart") {
		return refuseBody(
			OutboxAttachmentRejectionReason.MissingFile,
			"The upload carried no file. Try attaching the file again.",
		);
	}

	const client = await getClient();
	const result = await client.outboxAttachment.store({
		accountConfigId,
		outboxMessageId,
		filename: upload.file.filename,
		contentType: upload.file.contentType,
		content: upload.file.content,
	});

	if (result.outcome === "Rejected") return refuse(result.rejection);

	return result.attachment;
};
