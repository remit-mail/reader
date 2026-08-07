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
	OutboxLedger,
	OutboxLedgerEntry,
	StorageService,
} from "@remit/storage-service";
import {
	liveEntries,
	totalBytes,
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

/**
 * How many times a conditional ledger write may lose before the caller gives up.
 *
 * Every round has a winner, so a writer needs at most as many attempts as there
 * are writers contending — and contention is self-limiting: once the draft is
 * full, further mints are refused without writing at all. A ceiling's worth of
 * attempts plus headroom is therefore an upper bound, not a guess, and it still
 * stops a pathological case from spinning forever.
 */
const LEDGER_WRITE_ATTEMPTS = OUTBOX_ATTACHMENT_MAX_COUNT + 8;

export class OutboxAttachmentService {
	private readonly outboxMessageService: IOutboxMessageRepository;
	private readonly storage: StorageService;
	private readonly now: () => number;

	/**
	 * A courtesy, not the guarantee. Serializing mints for one draft inside this
	 * process keeps the common case from spending conditional writes on itself,
	 * but the cap is enforced by the ledger's compare-and-set in storage — this
	 * deployment shape is Lambda, where six parallel mints are six execution
	 * environments and no chain in any of them can see the others. Keyed by
	 * account and draft together, because the map is shared across tenants and a
	 * draft id is not a namespace.
	 */
	private readonly draftChains = new Map<string, Promise<unknown>>();

	constructor(config: OutboxAttachmentConfig) {
		this.outboxMessageService = config.outboxMessageService;
		this.storage = config.storage;
		this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
	}

	private serializePerDraft = async <T>(
		accountConfigId: string,
		outboxMessageId: string,
		run: () => Promise<T>,
	): Promise<T> => {
		const key = `${accountConfigId}/${outboxMessageId}`;
		const previous = this.draftChains.get(key);
		const started = previous ? previous.then(run, run) : run();
		const settled = started.then(
			() => undefined,
			() => undefined,
		);
		this.draftChains.set(key, settled);

		try {
			return await started;
		} finally {
			if (this.draftChains.get(key) === settled) {
				this.draftChains.delete(key);
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
	 * Read the ledger, decide, write it back conditionally, and rerun the whole
	 * decision if someone else wrote in between. `decide` must be pure with
	 * respect to storage: it is called again on every lost race.
	 */
	private updateLedger = async <T>(
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
		decide: (
			live: OutboxLedgerEntry[],
		) => { next: OutboxLedger; result: T } | { skip: T },
	): Promise<T> => {
		for (let attempt = 0; attempt < LEDGER_WRITE_ATTEMPTS; attempt += 1) {
			const { ledger, version } = await this.storage.readOutboxLedger(
				accountConfigId,
				accountId,
				outboxMessageId,
			);
			const live = liveEntries(ledger, this.now());
			const decision = decide(live);
			if ("skip" in decision) return decision.skip;

			const written = await this.storage.writeOutboxLedger(
				accountConfigId,
				accountId,
				outboxMessageId,
				decision.next,
				version,
			);
			if (written === "Written") return decision.result;
		}

		// Every attempt lost. Something is writing to this draft continuously;
		// failing loudly beats quietly admitting a file the cap did not clear.
		throw new ConflictError(
			"This message is being changed from somewhere else. Try attaching the file again.",
		);
	};

	/** Room on a draft for one file, and somewhere to put it. */
	mint = async (
		input: MintOutboxAttachmentInput,
	): Promise<MintOutboxAttachmentOutcome> =>
		this.serializePerDraft(input.accountConfigId, input.outboxMessageId, () =>
			this.mintUnderDraftLock(input),
		);

	private mintUnderDraftLock = async (
		input: MintOutboxAttachmentInput,
	): Promise<MintOutboxAttachmentOutcome> => {
		// Inside the lock, and reread on every conditional retry: a discard that
		// wins the race must be seen here, or a queued mint writes a reservation
		// into a prefix whose row is already gone.
		const outbox = await this.getWritableDraft(
			input.accountConfigId,
			input.outboxMessageId,
		);
		const accountId = outbox.accountId;

		const outboxAttachmentId = base36uuid();
		const filename = sanitizeAttachmentFilename(input.filename);
		const contentType = normalizeAttachmentContentType(input.contentType);

		const decision = await this.updateLedger<
			MintOutboxAttachmentOutcome | { reserved: OutboxLedgerEntry }
		>(input.accountConfigId, accountId, input.outboxMessageId, (live) => {
			const usedBytes = totalBytes(live);
			const reject = (
				reason: OutboxAttachmentRejectionReasonValue,
				message: string,
			): { skip: Refused } => ({
				skip: {
					outcome: "Rejected",
					rejection: {
						reason,
						message,
						limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
						usedBytes,
					},
				},
			});

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
			if (live.length >= OUTBOX_ATTACHMENT_MAX_COUNT) {
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

			const reserved: OutboxLedgerEntry = {
				outboxAttachmentId,
				filename,
				contentType,
				sizeBytes: input.sizeBytes,
				expiresAt: this.now() + UPLOAD_URL_TTL_SECONDS,
				uploaded: false,
			};
			// Only the live entries are carried forward, so a lapsed reservation
			// stops holding room the moment anyone writes the ledger again.
			return {
				next: { entries: [...live, reserved] },
				result: { reserved },
			};
		});

		if ("outcome" in decision) return decision;

		const { reserved } = decision;
		const target = await this.storage.createOutboxAttachmentUploadUrl({
			accountConfigId: input.accountConfigId,
			accountId,
			outboxMessageId: input.outboxMessageId,
			outboxAttachmentId,
			sizeBytes: reserved.sizeBytes,
			expiresAt: reserved.expiresAt,
		});

		return {
			outcome: "Minted",
			reservation: {
				outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				filename: reserved.filename,
				contentType: reserved.contentType,
				sizeBytes: reserved.sizeBytes,
				uploadUrl: target.uploadUrl,
				uploadExpiresAt: reserved.expiresAt,
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
	): Promise<CompleteOutboxAttachmentOutcome> =>
		this.serializePerDraft(input.accountConfigId, input.outboxMessageId, () =>
			this.completeUnderDraftLock(input),
		);

	private completeUnderDraftLock = async (
		input: CompleteOutboxAttachmentInput,
	): Promise<CompleteOutboxAttachmentOutcome> => {
		const outbox = await this.getWritableDraft(
			input.accountConfigId,
			input.outboxMessageId,
		);
		const accountId = outbox.accountId;

		const stored = await this.storage.statOutboxAttachment(
			input.accountConfigId,
			accountId,
			input.outboxMessageId,
			input.outboxAttachmentId,
		);

		const mismatched = await this.updateLedger<
			CompleteOutboxAttachmentOutcome | { confirmed: number }
		>(input.accountConfigId, accountId, input.outboxMessageId, (live) => {
			// Totalled over live entries only, so a refusal never quotes room that
			// a lapsed reservation is no longer holding.
			const usedBytes = totalBytes(live);
			const reject = (
				reason: OutboxAttachmentRejectionReasonValue,
				message: string,
			): { skip: Refused } => ({
				skip: {
					outcome: "Rejected",
					rejection: {
						reason,
						message,
						limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
						usedBytes,
					},
				},
			});

			const entry = live.find(
				(candidate) =>
					candidate.outboxAttachmentId === input.outboxAttachmentId,
			);
			if (!entry) {
				return reject(
					OutboxAttachmentRejectionReason.ReservationExpired,
					"That upload took too long and its reservation has lapsed. Attach the file again.",
				);
			}

			// Completing twice is a retry, not a fault: the second call is told the
			// same thing the first was.
			if (entry.uploaded) {
				return {
					skip: {
						outcome: "Completed",
						attachment: {
							outboxAttachmentId: entry.outboxAttachmentId,
							outboxMessageId: input.outboxMessageId,
							sizeBytes: entry.sizeBytes,
						},
					} as CompleteOutboxAttachmentOutcome,
				};
			}

			if (stored === null) {
				return reject(
					OutboxAttachmentRejectionReason.UploadMissing,
					"The file never finished uploading. Attach it again.",
				);
			}
			if (stored.sizeBytes !== entry.sizeBytes) {
				// Drop the reservation as well as the bytes: what landed is not what
				// was announced, and the room it was holding goes back.
				return {
					next: {
						entries: live.filter(
							(candidate) =>
								candidate.outboxAttachmentId !== input.outboxAttachmentId,
						),
					},
					result: { confirmed: -1 },
				};
			}

			return {
				next: {
					entries: live.map((candidate) =>
						candidate.outboxAttachmentId === input.outboxAttachmentId
							? { ...candidate, uploaded: true }
							: candidate,
					),
				},
				result: { confirmed: stored.sizeBytes },
			};
		});

		if ("outcome" in mismatched) return mismatched;

		if (mismatched.confirmed === -1) {
			await this.storage.deleteOutboxAttachment(
				input.accountConfigId,
				accountId,
				input.outboxMessageId,
				input.outboxAttachmentId,
			);
			return {
				outcome: "Rejected",
				rejection: {
					reason: OutboxAttachmentRejectionReason.SizeMismatch,
					message:
						"What arrived is not the file that was announced. Attach it again.",
					limitBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
					usedBytes: 0,
				},
			};
		}

		return {
			outcome: "Completed",
			attachment: {
				outboxAttachmentId: input.outboxAttachmentId,
				outboxMessageId: input.outboxMessageId,
				sizeBytes: mismatched.confirmed,
			},
		};
	};

	/**
	 * Drop every file and the ledger that referenced them. Called from wherever
	 * the outbox row is retired — a discard, and the APPEND to Sent that removes
	 * the row once the message has left. Nothing else references these objects,
	 * so a row that goes without this leaves bytes no one can reach.
	 *
	 * A presigned upload URL minted before this can still be spent afterwards, on
	 * a deployment where the bytes go straight to block storage and nothing
	 * consults the ledger on the way in. What lands is an object with no ledger
	 * entry, which `sweepAbandonedOutboxAttachments` collects.
	 */
	discardAll = (
		accountConfigId: string,
		accountId: string,
		outboxMessageId: string,
	): Promise<void> =>
		this.serializePerDraft(accountConfigId, outboxMessageId, () =>
			this.storage.deleteOutboxAttachments(
				accountConfigId,
				accountId,
				outboxMessageId,
			),
		);
}
