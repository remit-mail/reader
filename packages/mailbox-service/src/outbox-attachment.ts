import type { IOutboxMessageRepository } from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { base36uuid } from "@remit/data-ports/id";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	normalizeAttachmentContentType,
	sanitizeAttachmentFilename,
} from "./outbox-attachment-filename.js";

/**
 * 25 MB is what most receiving servers accept, and base64 inflates it to roughly
 * 34 MB on the wire. The same number caps one file and the sum of a draft's
 * files, so a single file can fill a message.
 */
export const OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * A ceiling on how many objects one draft can accumulate. The byte cap does not
 * bound the count — a thousand one-byte files stay far under it — and every
 * upload has to total the draft first, so the count is what keeps that read a
 * single bounded call.
 */
export const OUTBOX_ATTACHMENT_MAX_COUNT = 25;

export type OutboxAttachmentRejectionReasonValue =
	(typeof OutboxAttachmentRejectionReason)[keyof typeof OutboxAttachmentRejectionReason];

export interface OutboxAttachmentDescriptor {
	outboxAttachmentId: string;
	outboxMessageId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	checksumSha256: string;
}

export interface OutboxAttachmentRejectionDetail {
	reason: OutboxAttachmentRejectionReasonValue;
	message: string;
	limitBytes: number;
	usedBytes: number;
}

export type StoreOutboxAttachmentOutcome =
	| {
			readonly outcome: "Stored";
			readonly attachment: OutboxAttachmentDescriptor;
	  }
	| {
			readonly outcome: "Rejected";
			readonly rejection: OutboxAttachmentRejectionDetail;
	  };

export interface StoreOutboxAttachmentInput {
	accountConfigId: string;
	outboxMessageId: string;
	filename: string;
	contentType: string;
	content: Buffer;
}

export interface OutboxAttachmentConfig {
	outboxMessageService: IOutboxMessageRepository;
	storage: StorageService;
}

const formatBytes = (bytes: number): string =>
	`${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export class OutboxAttachmentService {
	private readonly outboxMessageService: IOutboxMessageRepository;
	private readonly storage: StorageService;

	constructor(config: OutboxAttachmentConfig) {
		this.outboxMessageService = config.outboxMessageService;
		this.storage = config.storage;
	}

	/**
	 * Write one file against a draft.
	 *
	 * Ownership and draft state are faults that abort the request — a foreign
	 * message is denied, an entry that has left draft is a conflict. Everything
	 * about the file itself comes back as a result the composer can render next
	 * to the row it refused.
	 */
	store = async (
		input: StoreOutboxAttachmentInput,
	): Promise<StoreOutboxAttachmentOutcome> => {
		// Mode "act": the caller has named the draft, so a foreign one is denied
		// with 403 rather than feigned as a 404.
		const outbox = await this.outboxMessageService.get(
			input.accountConfigId,
			input.outboxMessageId,
			"act",
		);

		if (outbox.status !== OutboxMessageStatus.draft) {
			throw new ConflictError(
				`This message is already ${outbox.status} and can no longer take an attachment. Start a new message to change it.`,
			);
		}

		const stored = await this.storage.listOutboxAttachments(
			input.accountConfigId,
			outbox.accountId,
			input.outboxMessageId,
			OUTBOX_ATTACHMENT_MAX_COUNT + 1,
		);
		const usedBytes = stored.reduce((total, item) => total + item.sizeBytes, 0);

		const reject = (
			reason: OutboxAttachmentRejectionReasonValue,
			message: string,
		): StoreOutboxAttachmentOutcome => ({
			outcome: "Rejected",
			rejection: {
				reason,
				message,
				limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
				usedBytes,
			},
		});

		const filename = sanitizeAttachmentFilename(input.filename);
		if (filename === null) {
			return reject(
				OutboxAttachmentRejectionReason.UnusableFilename,
				"That file's name is empty once path separators and hidden characters are removed. Rename it and try again.",
			);
		}

		if (input.content.length === 0) {
			return reject(
				OutboxAttachmentRejectionReason.EmptyFile,
				`"${filename}" is empty, so there is nothing to attach.`,
			);
		}

		if (stored.length >= OUTBOX_ATTACHMENT_MAX_COUNT) {
			return reject(
				OutboxAttachmentRejectionReason.TooManyAttachments,
				`This message already carries ${OUTBOX_ATTACHMENT_MAX_COUNT} files, the most one message can hold. Remove one to attach "${filename}".`,
			);
		}

		if (input.content.length > OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES) {
			return reject(
				OutboxAttachmentRejectionReason.FileTooLarge,
				`"${filename}" is ${formatBytes(input.content.length)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} a message can carry.`,
			);
		}

		if (usedBytes + input.content.length > OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES) {
			return reject(
				OutboxAttachmentRejectionReason.MessageTooLarge,
				`"${filename}" is ${formatBytes(input.content.length)} and this message already carries ${formatBytes(usedBytes)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} it can send.`,
			);
		}

		const outboxAttachmentId = base36uuid();
		const reference = await this.storage.storeOutboxAttachment({
			accountConfigId: input.accountConfigId,
			accountId: outbox.accountId,
			outboxMessageId: input.outboxMessageId,
			outboxAttachmentId,
			content: input.content,
		});

		return {
			outcome: "Stored",
			attachment: {
				outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				filename,
				contentType: normalizeAttachmentContentType(input.contentType),
				sizeBytes: input.content.length,
				checksumSha256: reference.checksumSha256,
			},
		};
	};
}
