import type {
	CreateOutboxMessageInput,
	MintOutboxAttachmentInput,
	MintOutboxAttachmentResponse,
	OutboxAttachmentRejection,
	OutboxAttachmentResponse,
	OutboxMessageResponse,
	UpdateOutboxMessageInput,
} from "@remit/api-openapi-types";
import type {
	OutboxAttachmentItem,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import { OutboxAttachmentRejectionReason } from "@remit/domain-enums";
import type {
	OutboxAttachmentRejectionDetail,
	OutboxAttachmentRejectionReasonValue,
} from "@remit/mailbox-service";
import { outboxAttachmentContentId } from "@remit/mailbox-service/outbox-attachment-content";
import type { ApiConfig } from "../config/api-config.js";
import { getContentSigner } from "../derive/contentSignature.js";
import { buildStorageContentUrl } from "../derive/contentUrl.js";
import type { RemitClient } from "./data-client.js";

export const toOutboxAttachmentResponse =
	(config: ApiConfig) =>
	(item: OutboxAttachmentItem): OutboxAttachmentResponse => ({
		outboxAttachmentId: item.outboxAttachmentId,
		outboxMessageId: item.outboxMessageId,
		filename: item.filename,
		contentType: item.contentType,
		sizeBytes: item.sizeBytes,
		state: item.state,
		contentId: outboxAttachmentContentId(item.outboxAttachmentId),
		contentUrl: buildStorageContentUrl({
			domain: config.contentDeliveryDomain,
			storageKey: item.storageKey,
			sign: getContentSigner(config),
		}),
	});

export const toOutboxMessageResponse = (
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

export const createOutboxMessageFor = async (
	client: RemitClient<"smtp">,
	config: ApiConfig,
	accountConfigId: string,
	input: CreateOutboxMessageInput,
): Promise<OutboxMessageResponse> => {
	const account = await client.account.get(input.accountId);
	if (account.accountConfigId !== accountConfigId) {
		throw new ForbiddenError(
			`Account ${input.accountId} not in account config`,
		);
	}

	const message = {
		accountId: input.accountId,
		accountConfigId,
		fromAddress: account.email,
		toAddresses: input.toAddresses,
		ccAddresses: input.ccAddresses,
		bccAddresses: input.bccAddresses,
		subject: input.subject,
		textBody: input.textBody,
		htmlBody: input.htmlBody,
		inReplyTo: input.inReplyTo,
		references: input.references,
	};
	const outbox = input.sendImmediately
		? await client.outboxQueue.createAndSend(message)
		: await client.outboxQueue.createDraft(message);
	return toOutboxMessageResponse(config, outbox);
};

export const listOutboxMessagesFor = async (
	client: RemitClient<never>,
	config: ApiConfig,
	accountConfigId: string,
	continuationToken?: string,
) => {
	const accounts = await client.account.listAllByAccountConfig(accountConfigId);
	if (accounts.length === 0) return { items: [], continuationToken: null };

	const result = await client.outboxMessage.listByAccounts(
		accounts.map((account) => account.accountId),
		{ continuationToken },
	);
	return {
		items: result.items.map((item) => toOutboxMessageResponse(config, item)),
		continuationToken: result.continuationToken,
	};
};

export const getOutboxMessageFor = async (
	client: RemitClient<never>,
	config: ApiConfig,
	accountConfigId: string,
	outboxMessageId: string,
): Promise<OutboxMessageResponse> => {
	const outbox = await client.outboxMessage.get(
		accountConfigId,
		outboxMessageId,
	);
	return toOutboxMessageResponse(
		config,
		outbox,
		await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
	);
};

export const updateOutboxMessageFor = async (
	client: RemitClient<"smtp">,
	config: ApiConfig,
	accountConfigId: string,
	outboxMessageId: string,
	input: UpdateOutboxMessageInput,
): Promise<OutboxMessageResponse> => {
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
	if (input.attachmentIds !== undefined) {
		await client.outboxAttachment.retainOnly(
			accountConfigId,
			updated.accountId,
			outboxMessageId,
			input.attachmentIds,
		);
	}
	return toOutboxMessageResponse(
		config,
		updated,
		await client.outboxAttachment.listFor(accountConfigId, outboxMessageId),
	);
};

export const deleteOutboxMessageFor = async (
	client: RemitClient<"smtp">,
	accountConfigId: string,
	outboxMessageId: string,
): Promise<void> => {
	await client.outboxQueue.deleteDraft(accountConfigId, outboxMessageId);
};

export const sendOutboxMessageFor = async (
	client: RemitClient<"smtp">,
	config: ApiConfig,
	accountConfigId: string,
	outboxMessageId: string,
): Promise<OutboxMessageResponse> =>
	toOutboxMessageResponse(
		config,
		await client.outboxQueue.send(accountConfigId, outboxMessageId),
	);

const ATTACHMENT_REJECTED_CODE = "attachment_rejected";
const TOO_LARGE: ReadonlySet<OutboxAttachmentRejectionReasonValue> = new Set([
	OutboxAttachmentRejectionReason.FileTooLarge,
	OutboxAttachmentRejectionReason.MessageTooLarge,
	OutboxAttachmentRejectionReason.TooManyAttachments,
]);

export interface OutboxAttachmentRejectionResponse {
	statusCode: number;
	body: OutboxAttachmentRejection;
}

export const refuseAttachment = (
	detail: OutboxAttachmentRejectionDetail,
): OutboxAttachmentRejectionResponse => ({
	statusCode: TOO_LARGE.has(detail.reason) ? 413 : 400,
	body: {
		code: ATTACHMENT_REJECTED_CODE,
		reason: detail.reason,
		message: detail.message,
		limitBytes: detail.limitBytes,
		usedBytes: detail.usedBytes,
	},
});

export const mintOutboxAttachmentFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	outboxMessageId: string,
	input: MintOutboxAttachmentInput,
): Promise<
	MintOutboxAttachmentResponse | OutboxAttachmentRejectionResponse
> => {
	const result = await client.outboxAttachment.mint({
		accountConfigId,
		outboxMessageId,
		filename: input.filename,
		contentType: input.contentType,
		sizeBytes: input.sizeBytes,
	});
	return result.outcome === "Rejected"
		? refuseAttachment(result.rejection)
		: result.reservation;
};

export const completeOutboxAttachmentFor = async (
	client: RemitClient<never>,
	config: ApiConfig,
	accountConfigId: string,
	outboxMessageId: string,
	outboxAttachmentId: string,
): Promise<OutboxAttachmentResponse | OutboxAttachmentRejectionResponse> => {
	const result = await client.outboxAttachment.complete({
		accountConfigId,
		outboxMessageId,
		outboxAttachmentId,
	});
	return result.outcome === "Rejected"
		? refuseAttachment(result.rejection)
		: toOutboxAttachmentResponse(config)(result.attachment);
};
