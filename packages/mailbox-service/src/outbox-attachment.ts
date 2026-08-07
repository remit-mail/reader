import type {
	IOutboxAttachmentRepository,
	IOutboxMessageRepository,
	OutboxAttachmentItem,
	OutboxMessageItem,
} from "@remit/data-ports";
import { holdsRoom } from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { base36uuid } from "@remit/data-ports/id";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	buildOutboxAttachmentKey,
	UPLOAD_URL_TTL_SECONDS,
} from "@remit/storage-service";
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
 * A ceiling on how many files one draft can accumulate. The byte cap does not
 * bound the count — a thousand one-byte files stay far under it.
 */
export const OUTBOX_ATTACHMENT_MAX_COUNT = 25;

export type OutboxAttachmentRejectionReasonValue =
	(typeof OutboxAttachmentRejectionReason)[keyof typeof OutboxAttachmentRejectionReason];

export interface OutboxAttachmentReservation {
	outboxAttachmentId: string;
	outboxMessageId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	uploadUrl: string;
	uploadExpiresAt: number;
}

export interface OutboxAttachmentRejectionDetail {
	reason: OutboxAttachmentRejectionReasonValue;
	message: string;
	limitBytes: number;
	usedBytes: number;
}

type Refused = {
	readonly outcome: "Rejected";
	readonly rejection: OutboxAttachmentRejectionDetail;
};

export type MintOutboxAttachmentOutcome =
	| {
			readonly outcome: "Minted";
			readonly reservation: OutboxAttachmentReservation;
	  }
	| Refused;

export type CompleteOutboxAttachmentOutcome =
	| { readonly outcome: "Completed"; readonly attachment: OutboxAttachmentItem }
	| Refused;

export interface MintOutboxAttachmentInput {
	accountConfigId: string;
	outboxMessageId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
}

export interface CompleteOutboxAttachmentInput {
	accountConfigId: string;
	outboxMessageId: string;
	outboxAttachmentId: string;
}

export interface OutboxAttachmentConfig {
	outboxMessageService: IOutboxMessageRepository;
	outboxAttachmentService: IOutboxAttachmentRepository;
	storage: StorageService;
	now?: () => number;
}

const formatBytes = (bytes: number): string =>
	`${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export class OutboxAttachmentService {
	private readonly outboxMessageService: IOutboxMessageRepository;
	private readonly attachments: IOutboxAttachmentRepository;
	private readonly storage: StorageService;
	private readonly now: () => number;

	constructor(config: OutboxAttachmentConfig) {
		this.outboxMessageService = config.outboxMessageService;
		this.attachments = config.outboxAttachmentService;
		this.storage = config.storage;
		this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
	}

	/**
	 * Resolve a draft the caller is entitled to act on.
	 *
	 * Mode "act": the caller has named the draft, so a foreign one is denied with
	 * 403 rather than feigned as a 404. An entry that has left draft is a
	 * conflict. Both abort the request — only the file itself comes back as a
	 * result the composer can render next to the row it refused.
	 */
	private getWritableDraft = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxMessageItem> => {
		const outbox = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);

		if (outbox.status !== OutboxMessageStatus.draft) {
			throw new ConflictError(
				`This message is already ${outbox.status} and can no longer take an attachment. Start a new message to change it.`,
			);
		}

		return outbox;
	};

	private usedBytesOn = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<number> => {
		const held = await this.attachments.listByOutboxMessage(
			accountConfigId,
			outboxMessageId,
		);
		const nowSeconds = this.now();
		return held
			.filter((item) => holdsRoom(item, nowSeconds))
			.reduce((total, item) => total + item.sizeBytes, 0);
	};

	private reject = (
		reason: OutboxAttachmentRejectionReasonValue,
		message: string,
		usedBytes: number,
	): Refused => ({
		outcome: "Rejected",
		rejection: {
			reason,
			message,
			limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
			usedBytes,
		},
	});

	/**
	 * Room on a draft for one file, and somewhere to put it.
	 *
	 * The row is written before the URL is handed out, and writing it is what
	 * claims the room — the count and the insert are one database transaction, so
	 * two requests arriving together cannot both be told there was space. That is
	 * the whole of the cap; nothing above this layer needs to serialize anything.
	 */
	mint = async (
		input: MintOutboxAttachmentInput,
	): Promise<MintOutboxAttachmentOutcome> => {
		const outbox = await this.getWritableDraft(
			input.accountConfigId,
			input.outboxMessageId,
		);

		const filename = sanitizeAttachmentFilename(input.filename);
		if (filename === null) {
			return this.reject(
				OutboxAttachmentRejectionReason.UnusableFilename,
				"That file's name is empty once path separators and hidden characters are removed. Rename it and try again.",
				await this.usedBytesOn(input.accountConfigId, input.outboxMessageId),
			);
		}
		if (input.sizeBytes <= 0) {
			return this.reject(
				OutboxAttachmentRejectionReason.EmptyFile,
				`"${filename}" is empty, so there is nothing to attach.`,
				await this.usedBytesOn(input.accountConfigId, input.outboxMessageId),
			);
		}
		if (input.sizeBytes > OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES) {
			return this.reject(
				OutboxAttachmentRejectionReason.FileTooLarge,
				`"${filename}" is ${formatBytes(input.sizeBytes)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} a message can carry.`,
				await this.usedBytesOn(input.accountConfigId, input.outboxMessageId),
			);
		}

		const nowSeconds = this.now();
		const reservationExpiresAt = nowSeconds + UPLOAD_URL_TTL_SECONDS;
		// The id is the row's own, and the key is built from it after the fact, so
		// there is exactly one place an attachment's identity comes from.
		const outboxAttachmentId = base36uuid();
		const storageKey = buildOutboxAttachmentKey(
			input.accountConfigId,
			outbox.accountId,
			input.outboxMessageId,
			outboxAttachmentId,
		);

		const reserved = await this.attachments.reserve(
			{
				outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				accountId: outbox.accountId,
				accountConfigId: input.accountConfigId,
				filename,
				contentType: normalizeAttachmentContentType(input.contentType),
				sizeBytes: input.sizeBytes,
				storageKey,
				reservationExpiresAt,
			},
			{
				maxTotalBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
				maxCount: OUTBOX_ATTACHMENT_MAX_COUNT,
				nowSeconds,
			},
		);

		if (reserved.outcome === "OverCountCap") {
			return this.reject(
				OutboxAttachmentRejectionReason.TooManyAttachments,
				`This message already carries ${OUTBOX_ATTACHMENT_MAX_COUNT} files, the most one message can hold. Remove one to attach "${filename}".`,
				reserved.usedBytes,
			);
		}
		if (reserved.outcome === "OverByteCap") {
			return this.reject(
				OutboxAttachmentRejectionReason.MessageTooLarge,
				`"${filename}" is ${formatBytes(input.sizeBytes)} and this message already carries ${formatBytes(reserved.usedBytes)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} it can send.`,
				reserved.usedBytes,
			);
		}

		const target = await this.storage.createOutboxAttachmentUploadUrl({
			accountConfigId: input.accountConfigId,
			accountId: outbox.accountId,
			outboxMessageId: input.outboxMessageId,
			outboxAttachmentId: reserved.item.outboxAttachmentId,
			sizeBytes: input.sizeBytes,
			expiresAt: reservationExpiresAt,
		});

		return {
			outcome: "Minted",
			reservation: {
				outboxAttachmentId: reserved.item.outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				filename: reserved.item.filename,
				contentType: reserved.item.contentType,
				sizeBytes: reserved.item.sizeBytes,
				uploadUrl: target.uploadUrl,
				uploadExpiresAt: reservationExpiresAt,
			},
		};
	};

	/**
	 * Turn an upload into an attachment, on storage's word rather than the
	 * client's.
	 *
	 * On a hosted deployment the bytes went straight to block storage and this is
	 * the first the API hears of them, so the size is read back before the row is
	 * moved to Stored. An object that is absent, or not the size reserved for it,
	 * does not become an attachment — phase 4 sends these bytes, and an
	 * attachment recorded over nothing is a message that cannot be built.
	 */
	complete = async (
		input: CompleteOutboxAttachmentInput,
	): Promise<CompleteOutboxAttachmentOutcome> => {
		const outbox = await this.getWritableDraft(
			input.accountConfigId,
			input.outboxMessageId,
		);

		const held = await this.attachments.listByOutboxMessage(
			input.accountConfigId,
			input.outboxMessageId,
		);
		const nowSeconds = this.now();
		const usedBytes = held
			.filter((item) => holdsRoom(item, nowSeconds))
			.reduce((total, item) => total + item.sizeBytes, 0);

		const row = held.find(
			(item) => item.outboxAttachmentId === input.outboxAttachmentId,
		);
		if (!row || !holdsRoom(row, nowSeconds)) {
			return this.reject(
				OutboxAttachmentRejectionReason.ReservationExpired,
				"That upload took too long and its reservation has lapsed. Attach the file again.",
				usedBytes,
			);
		}

		// Completing twice is a retry, not a fault: the second call is told what
		// the first was.
		if (row.state === "Stored") {
			return { outcome: "Completed", attachment: row };
		}

		const stored = await this.storage.statOutboxAttachment(
			input.accountConfigId,
			outbox.accountId,
			input.outboxMessageId,
			input.outboxAttachmentId,
		);
		if (stored === null) {
			return this.reject(
				OutboxAttachmentRejectionReason.UploadMissing,
				"The file never finished uploading. Attach it again.",
				usedBytes,
			);
		}
		if (stored.sizeBytes !== row.sizeBytes) {
			// What landed is not what was announced. Take the row and the bytes,
			// so the room goes back and nothing points at a file that is not there.
			await this.attachments.deleteMany(input.accountConfigId, [
				input.outboxAttachmentId,
			]);
			await this.storage.deleteOutboxAttachment(
				input.accountConfigId,
				outbox.accountId,
				input.outboxMessageId,
				input.outboxAttachmentId,
			);
			return this.reject(
				OutboxAttachmentRejectionReason.SizeMismatch,
				"What arrived is not the file that was announced. Attach it again.",
				Math.max(0, usedBytes - row.sizeBytes),
			);
		}

		const confirmed = await this.attachments.markStored(
			input.accountConfigId,
			input.outboxAttachmentId,
			stored.sizeBytes,
		);
		if (confirmed === null) {
			// Another completion moved it between the read and the update. Read it
			// back rather than guess.
			const settled = await this.attachments.get(
				input.accountConfigId,
				input.outboxAttachmentId,
			);
			return { outcome: "Completed", attachment: settled };
		}

		return { outcome: "Completed", attachment: confirmed };
	};

	/**
	 * Whether an attachment is still owed its bytes. The self-hosted upload route
	 * asks before it writes, so a URL minted before a discard cannot put bytes
	 * back under a draft that is gone.
	 */
	hasLiveReservation = async (
		accountConfigId: string,
		outboxAttachmentId: string,
	): Promise<boolean> => {
		const row = await this.attachments
			.get(accountConfigId, outboxAttachmentId)
			.catch(() => null);
		// Pending only. A Stored row has already been confirmed at a size, and its
		// URL stays signed for the rest of its window — accepting a second write
		// would let the same-length bytes behind a confirmed attachment be
		// replaced.
		return (
			row !== null &&
			row.state === "Pending" &&
			row.reservationExpiresAt >= this.now()
		);
	};

	/**
	 * What a draft holds, as the composer should see it: reservations that have
	 * lapsed are not files, and showing one with no way to tell it apart is worse
	 * than not showing it.
	 */
	listFor = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxAttachmentItem[]> => {
		const nowSeconds = this.now();
		const held = await this.attachments.listByOutboxMessage(
			accountConfigId,
			outboxMessageId,
		);
		return held.filter((item) => holdsRoom(item, nowSeconds));
	};

	/**
	 * Drop the draft's lapsed reservations and answer with the ids that are still
	 * good. The sweep runs this before it decides what to collect: a lapsed row
	 * would otherwise keep vouching for bytes nothing will ever send, and the
	 * object would never be collected while the row that names it survives.
	 */
	reapAndListLive = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<string[]> => {
		await this.attachments.deleteLapsedReservations(
			accountConfigId,
			outboxMessageId,
			this.now(),
		);
		const held = await this.attachments.listByOutboxMessage(
			accountConfigId,
			outboxMessageId,
		);
		return held.map((item) => item.outboxAttachmentId);
	};

	/**
	 * Keep only the named attachments, deleting the rest with their bytes. This
	 * is how a composer removes a file: the update states what the draft keeps.
	 */
	retainOnly = async (
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		keepIds: readonly string[],
	): Promise<void> => {
		const held = await this.attachments.listByOutboxMessage(
			accountConfigId,
			outboxMessageId,
		);
		const keep = new Set(keepIds);
		const drop = held.filter((item) => !keep.has(item.outboxAttachmentId));
		if (drop.length === 0) return;

		// Bytes first, rows second — the same order as `discardAll`, and for the
		// same reason: while a row exists its object is accounted for, so a
		// failure part-way leaves something the sweep can still finish. One
		// object that will not delete must not strand the rest, so the failures
		// are collected and raised together once the rows are gone.
		const failures: unknown[] = [];
		for (const item of drop) {
			await this.storage
				.deleteOutboxAttachment(
					accountConfigId,
					accountId,
					outboxMessageId,
					item.outboxAttachmentId,
				)
				.catch((error: unknown) => failures.push(error));
		}

		await this.attachments.deleteMany(
			accountConfigId,
			drop.map((item) => item.outboxAttachmentId),
		);

		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Could not delete ${failures.length} of ${drop.length} attachment objects; their rows are gone and the sweep will collect them`,
			);
		}
	};

	/**
	 * Drop every file a draft holds, rows and bytes, as the draft is retired —
	 * a discard, or the APPEND to Sent that removes the row once the message has
	 * left. Rows go last: while they exist the objects are accounted for, and a
	 * failure part-way leaves the sweep able to finish the job.
	 */
	discardAll = async (
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<void> => {
		await this.storage.deleteOutboxAttachments(
			accountConfigId,
			accountId,
			outboxMessageId,
		);
		await this.attachments.deleteByOutboxMessage(
			accountConfigId,
			outboxMessageId,
		);
	};
}
