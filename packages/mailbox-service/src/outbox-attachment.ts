import type {
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { base36uuid } from "@remit/data-ports/id";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import type {
	OutboxAttachmentListItem,
	StorageService,
} from "@remit/storage-service";
import { UPLOAD_URL_TTL_SECONDS } from "@remit/storage-service";
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
 * bound the count — a thousand one-byte files stay far under it — and every
 * mint has to total the draft first, so the count is what keeps that read a
 * single bounded call.
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

export interface OutboxAttachmentDescriptor {
	outboxAttachmentId: string;
	outboxMessageId: string;
	sizeBytes: number;
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
	| {
			readonly outcome: "Completed";
			readonly attachment: OutboxAttachmentDescriptor;
	  }
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
	storage: StorageService;
	now?: () => number;
}

const formatBytes = (bytes: number): string =>
	`${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export class OutboxAttachmentService {
	private readonly outboxMessageService: IOutboxMessageRepository;
	private readonly storage: StorageService;
	private readonly now: () => number;

	/**
	 * One promise chain per draft. Reserving is a read-then-write — total the
	 * draft, then write the reservation — and a composer dropping six files at
	 * once mints six times in parallel. Unserialized they would each total a
	 * draft none of them had written to yet, and all six would pass a cap none of
	 * them individually breaks. Per draft, so unrelated drafts never wait on each
	 * other; in-process, because the mint is the only place capacity is claimed
	 * and one backend owns a deployment. The entry is dropped as soon as nothing
	 * is queued behind it, so the map holds work in flight rather than every
	 * draft ever touched.
	 */
	private readonly draftChains = new Map<string, Promise<unknown>>();

	constructor(config: OutboxAttachmentConfig) {
		this.outboxMessageService = config.outboxMessageService;
		this.storage = config.storage;
		this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
	}

	private serializePerDraft = async <T>(
		outboxMessageId: string,
		run: () => Promise<T>,
	): Promise<T> => {
		const previous = this.draftChains.get(outboxMessageId);
		const started = previous ? previous.then(run, run) : run();
		const settled = started.then(
			() => undefined,
			() => undefined,
		);
		this.draftChains.set(outboxMessageId, settled);

		try {
			return await started;
		} finally {
			if (this.draftChains.get(outboxMessageId) === settled) {
				this.draftChains.delete(outboxMessageId);
			}
		}
	};

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

	/**
	 * Reclaim room held by mints that never became uploads — the browser closed,
	 * the tab crashed, the sender changed their mind. A reservation carries its
	 * own expiry, and once past it the reservation and anything uploaded under it
	 * are both deleted: bytes that arrived and were never confirmed belong to
	 * nothing, because that id was only ever going to be reachable through a
	 * completed attachment.
	 *
	 * This runs at the head of every mint against the draft, under the same lock,
	 * so a draft still in use collects itself. A draft nobody returns to is
	 * collected wholesale when it is discarded or sent, which deletes the prefix.
	 */
	private sweepExpired = async (
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		entries: readonly OutboxAttachmentListItem[],
	): Promise<OutboxAttachmentListItem[]> => {
		const nowSeconds = this.now();
		const expired = entries.filter(
			(entry) => entry.isReservation && entry.expiresAt < nowSeconds,
		);
		if (expired.length === 0) return [...entries];

		const abandoned = new Set(expired.map((entry) => entry.outboxAttachmentId));
		for (const outboxAttachmentId of abandoned) {
			await this.storage.deleteOutboxAttachment(
				accountConfigId,
				accountId,
				outboxMessageId,
				outboxAttachmentId,
			);
		}
		return entries.filter((entry) => !abandoned.has(entry.outboxAttachmentId));
	};

	/**
	 * What a draft is already spoken for. An uploaded object and its outstanding
	 * reservation are the same attachment, so the larger of the two counts once —
	 * a part-written object must never read as room.
	 */
	private holdingsOf = (
		entries: readonly OutboxAttachmentListItem[],
	): Map<string, number> => {
		const perAttachment = new Map<string, number>();
		for (const entry of entries) {
			const held = perAttachment.get(entry.outboxAttachmentId) ?? 0;
			perAttachment.set(
				entry.outboxAttachmentId,
				Math.max(held, entry.sizeBytes),
			);
		}
		return perAttachment;
	};

	// Two entries per attachment at most, an object and its reservation, and one
	// attachment over the ceiling so a full draft is recognisable.
	private readonly listLimit = (OUTBOX_ATTACHMENT_MAX_COUNT + 1) * 2;

	/** Room on a draft for one file, and somewhere to put it. */
	mint = async (
		input: MintOutboxAttachmentInput,
	): Promise<MintOutboxAttachmentOutcome> => {
		const outbox = await this.getWritableDraft(
			input.accountConfigId,
			input.outboxMessageId,
		);

		return this.serializePerDraft(input.outboxMessageId, () =>
			this.mintUnderDraftLock(input, outbox.accountId),
		);
	};

	private mintUnderDraftLock = async (
		input: MintOutboxAttachmentInput,
		accountId: string,
	): Promise<MintOutboxAttachmentOutcome> => {
		const listed = await this.storage.listOutboxAttachments(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			this.listLimit,
		);
		const live = await this.sweepExpired(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			listed,
		);

		const holdings = this.holdingsOf(live);
		const usedBytes = [...holdings.values()].reduce(
			(total, bytes) => total + bytes,
			0,
		);

		const reject = (
			reason: OutboxAttachmentRejectionReasonValue,
			message: string,
		): Refused => ({
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

		if (input.sizeBytes <= 0) {
			return reject(
				OutboxAttachmentRejectionReason.EmptyFile,
				`"${filename}" is empty, so there is nothing to attach.`,
			);
		}

		if (holdings.size >= OUTBOX_ATTACHMENT_MAX_COUNT) {
			return reject(
				OutboxAttachmentRejectionReason.TooManyAttachments,
				`This message already carries ${OUTBOX_ATTACHMENT_MAX_COUNT} files, the most one message can hold. Remove one to attach "${filename}".`,
			);
		}

		if (input.sizeBytes > OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES) {
			return reject(
				OutboxAttachmentRejectionReason.FileTooLarge,
				`"${filename}" is ${formatBytes(input.sizeBytes)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} a message can carry.`,
			);
		}

		if (usedBytes + input.sizeBytes > OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES) {
			return reject(
				OutboxAttachmentRejectionReason.MessageTooLarge,
				`"${filename}" is ${formatBytes(input.sizeBytes)} and this message already carries ${formatBytes(usedBytes)}, over the ${formatBytes(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES)} it can send.`,
			);
		}

		const outboxAttachmentId = base36uuid();
		const expiresAt = this.now() + UPLOAD_URL_TTL_SECONDS;
		const params = {
			accountConfigId: input.accountConfigId,
			accountId,
			outboxMessageId: input.outboxMessageId,
			outboxAttachmentId,
			sizeBytes: input.sizeBytes,
			expiresAt,
		};

		// Reservation before URL: the reservation is what holds the room, and a
		// URL handed out ahead of it is a cap that can be walked past by minting
		// faster than uploading.
		await this.storage.reserveOutboxAttachment(params);
		const target = await this.storage.createOutboxAttachmentUploadUrl(params);

		return {
			outcome: "Minted",
			reservation: {
				outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				filename,
				contentType: normalizeAttachmentContentType(input.contentType),
				sizeBytes: input.sizeBytes,
				uploadUrl: target.uploadUrl,
				uploadExpiresAt: expiresAt,
			},
		};
	};

	/**
	 * Turn an upload into an attachment, on storage's word rather than the
	 * client's.
	 *
	 * On a hosted deployment the bytes went straight to block storage and this is
	 * the first the API hears of them, so the size is read back before anything
	 * is confirmed. An object that is absent, or not the size reserved for it,
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

		return this.serializePerDraft(input.outboxMessageId, () =>
			this.completeUnderDraftLock(input, outbox.accountId),
		);
	};

	private completeUnderDraftLock = async (
		input: CompleteOutboxAttachmentInput,
		accountId: string,
	): Promise<CompleteOutboxAttachmentOutcome> => {
		const entries = await this.storage.listOutboxAttachments(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			this.listLimit,
		);
		const usedBytes = [...this.holdingsOf(entries).values()].reduce(
			(total, bytes) => total + bytes,
			0,
		);

		const reject = (
			reason: OutboxAttachmentRejectionReasonValue,
			message: string,
		): Refused => ({
			outcome: "Rejected",
			rejection: {
				reason,
				message,
				limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
				usedBytes,
			},
		});

		const reservation = entries.find(
			(entry) =>
				entry.isReservation &&
				entry.outboxAttachmentId === input.outboxAttachmentId,
		);
		if (!reservation || reservation.expiresAt < this.now()) {
			return reject(
				OutboxAttachmentRejectionReason.ReservationExpired,
				"That upload took too long and its reservation has lapsed. Attach the file again.",
			);
		}

		const stored = await this.storage.statOutboxAttachment(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			input.outboxAttachmentId,
		);
		if (stored === null) {
			return reject(
				OutboxAttachmentRejectionReason.UploadMissing,
				"The file never finished uploading. Attach it again.",
			);
		}

		if (stored.sizeBytes !== reservation.sizeBytes) {
			// What landed is not what was reserved for. Take it away rather than
			// leave an object nothing will ever reference.
			await this.storage.deleteOutboxAttachment(
				input.accountConfigId,
				accountId,
				input.outboxMessageId,
				input.outboxAttachmentId,
			);
			return reject(
				OutboxAttachmentRejectionReason.SizeMismatch,
				"What arrived is not the file that was announced. Attach it again.",
			);
		}

		await this.storage.releaseOutboxAttachmentReservation(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			input.outboxAttachmentId,
			reservation.sizeBytes,
			reservation.expiresAt,
		);

		return {
			outcome: "Completed",
			attachment: {
				outboxAttachmentId: input.outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				sizeBytes: stored.sizeBytes,
			},
		};
	};

	/**
	 * Drop every file and reservation held against a draft. Called from wherever
	 * the outbox row is retired — a discard, and the APPEND to Sent that removes
	 * the row once the message has left. Nothing else references these objects,
	 * so a row that goes without this leaves bytes no one can reach and no sweep
	 * collects.
	 *
	 * Takes the draft lock so a discard cannot interleave with a mint and leave
	 * behind the reservation that mint was writing. A storage failure aborts the
	 * discard rather than being swallowed: the caller deletes the row after this
	 * returns, and orphaning is the outcome this exists to prevent.
	 */
	discardAll = (
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<void> =>
		this.serializePerDraft(outboxMessageId, () =>
			this.storage.deleteOutboxAttachments(
				accountConfigId,
				accountId,
				outboxMessageId,
			),
		);
}
