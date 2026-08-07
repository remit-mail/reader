import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	createMockStorageService,
	liveEntries,
	type StorageService,
	sweepAbandonedOutboxAttachments,
	totalBytes,
	UPLOAD_URL_TTL_SECONDS,
} from "@remit/storage-service";
import {
	OUTBOX_ATTACHMENT_MAX_COUNT,
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	OutboxAttachmentService,
} from "./outbox-attachment.js";

const ACCOUNT_CONFIG_ID = "cfg-679";
const ACCOUNT_ID = "acc-679";
const DRAFT_ID = "draft-679";

/**
 * A storage whose reads and writes each yield to the event loop, so anything
 * that totals a draft and then writes to it has a real window in which another
 * caller can slip between the two. Without it the concurrency tests below would
 * pass on a serial implementation by accident.
 */
const withScheduling = (inner: StorageService): StorageService => {
	const yieldToLoop = (): Promise<void> =>
		new Promise((resolve) => setTimeout(resolve, 0));

	return {
		...inner,
		listOutboxAttachments: async (...args) => {
			await yieldToLoop();
			return inner.listOutboxAttachments(...args);
		},
		storeOutboxAttachment: async (params) => {
			await yieldToLoop();
			return inner.storeOutboxAttachment(params);
		},
		deleteOutboxAttachments: async (...args) => {
			await yieldToLoop();
			return inner.deleteOutboxAttachments(...args);
		},
		readOutboxLedger: async (...args) => {
			await yieldToLoop();
			return inner.readOutboxLedger(...args);
		},
		writeOutboxLedger: async (...args) => {
			await yieldToLoop();
			return inner.writeOutboxLedger(...args);
		},
	};
};

const build = (
	status: OutboxMessageItem["status"] = OutboxMessageStatus.draft,
	now?: () => number,
): { service: OutboxAttachmentService; storage: StorageService } => {
	const storage = withScheduling(createMockStorageService());
	const outboxMessageService = {
		get: async (
			accountConfigId: string,
			_id: string,
			mode?: "read" | "act",
		) => {
			if (accountConfigId !== ACCOUNT_CONFIG_ID) {
				assert.equal(mode, "act");
				throw new ForbiddenError("not yours");
			}
			return {
				outboxMessageId: DRAFT_ID,
				accountId: ACCOUNT_ID,
				accountConfigId,
				status,
			} as OutboxMessageItem;
		},
	} as unknown as IOutboxMessageRepository;

	return {
		service: new OutboxAttachmentService({
			outboxMessageService,
			storage,
			now,
		}),
		storage,
	};
};

const mint = (
	service: OutboxAttachmentService,
	overrides: Partial<{
		accountConfigId: string;
		filename: string;
		contentType: string;
		sizeBytes: number;
	}> = {},
) =>
	service.mint({
		accountConfigId: overrides.accountConfigId ?? ACCOUNT_CONFIG_ID,
		outboxMessageId: DRAFT_ID,
		filename: overrides.filename ?? "notes.txt",
		contentType: overrides.contentType ?? "text/plain",
		sizeBytes: overrides.sizeBytes ?? 10,
	});

/**
 * Files already uploaded and confirmed against the draft: the bytes and the
 * ledger entry that vouches for them. An object without an entry is garbage the
 * cap deliberately ignores, so seeding one alone would not be "already there".
 */
const fill = async (
	storage: StorageService,
	count: number,
	sizeBytes: number,
): Promise<void> => {
	const entries = [];
	for (let index = 0; index < count; index += 1) {
		const outboxAttachmentId = `existing-${index}`;
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId,
			content: Buffer.alloc(sizeBytes),
		});
		entries.push({
			outboxAttachmentId,
			filename: `existing-${index}.bin`,
			contentType: "application/octet-stream",
			sizeBytes,
			expiresAt: 0,
			uploaded: true,
		});
	}
	const { version } = await storage.readOutboxLedger(
		ACCOUNT_CONFIG_ID,
		ACCOUNT_ID,
		DRAFT_ID,
	);
	await storage.writeOutboxLedger(
		ACCOUNT_CONFIG_ID,
		ACCOUNT_ID,
		DRAFT_ID,
		{ entries },
		version,
	);
};

/** What the draft is spoken for, reservations included — the ledger's word. */
const heldBytes = async (
	storage: StorageService,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<number> => {
	const { ledger } = await storage.readOutboxLedger(
		ACCOUNT_CONFIG_ID,
		ACCOUNT_ID,
		DRAFT_ID,
	);
	return totalBytes(liveEntries(ledger, nowSeconds));
};

describe("OutboxAttachmentService: reserving", () => {
	it("reserves and hands back a URL bound to the size it reserved", async () => {
		const { service, storage } = build();

		const result = await mint(service, {
			filename: "invoice.pdf",
			contentType: "application/pdf",
			sizeBytes: 2048,
		});

		assert.equal(result.outcome, "Minted");
		if (result.outcome !== "Minted") return;
		assert.equal(result.reservation.filename, "invoice.pdf");
		assert.equal(result.reservation.contentType, "application/pdf");
		assert.equal(result.reservation.sizeBytes, 2048);
		assert.match(result.reservation.uploadUrl, /max=2048/);
		assert.equal(await heldBytes(storage), 2048);
	});

	it("refuses a declared size over the cap, reporting what is already held", async () => {
		const { service, storage } = build();
		await fill(storage, 1, 1024);

		const result = await mint(service, {
			filename: "huge.bin",
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES + 1,
		});

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.FileTooLarge,
		);
		assert.equal(result.rejection.usedBytes, 1024);
		assert.equal(
			result.rejection.limitBytes,
			OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
		);
	});

	it("refuses a file that only overflows once the draft's own files are counted", async () => {
		const { service, storage } = build();
		await fill(storage, 1, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 100);

		const result = await mint(service, { sizeBytes: 200 });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.MessageTooLarge,
		);
	});

	it("refuses once the draft holds the most files a message can", async () => {
		const { service, storage } = build();
		await fill(storage, OUTBOX_ATTACHMENT_MAX_COUNT, 1);

		const result = await mint(service);

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.TooManyAttachments,
		);
	});

	it("refuses a file declared as empty", async () => {
		const { service } = build();

		const result = await mint(service, { sizeBytes: 0 });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.EmptyFile,
		);
	});

	it("refuses a filename that sanitizes to nothing", async () => {
		const { service } = build();

		const result = await mint(service, { filename: "../.." });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.UnusableFilename,
		);
	});

	it("records a filename stripped of its path and a media type it cannot read", async () => {
		const { service } = build();

		const result = await mint(service, {
			filename: "../../etc/passwd",
			contentType: "",
		});

		assert.equal(result.outcome, "Minted");
		if (result.outcome !== "Minted") return;
		assert.equal(result.reservation.filename, "passwd");
		assert.equal(result.reservation.contentType, "application/octet-stream");
	});

	it("denies a mint against a draft owned by someone else", async () => {
		const { service, storage } = build();

		await assert.rejects(
			() => mint(service, { accountConfigId: "cfg-stranger" }),
			ForbiddenError,
		);
		assert.equal(await heldBytes(storage), 0);
	});

	it("refuses to reserve on a message that has left draft", async () => {
		const { service } = build(OutboxMessageStatus.queued);

		await assert.rejects(() => mint(service), {
			name: "ConflictError",
			message: /no longer take an attachment/,
		});
	});
});

describe("OutboxAttachmentService: mints racing each other", () => {
	it("keeps the byte cap when files are dropped in together", async () => {
		const { service, storage } = build();
		const fiveMegabytes = 5 * 1024 * 1024;

		// Six at once against a 25 MB cap: unserialized, all six total the draft
		// before any of them has reserved, all six see room, and the draft ends up
		// promising 30 MB it cannot send.
		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				mint(service, { sizeBytes: fiveMegabytes }),
			),
		);

		assert.equal(
			results.filter((result) => result.outcome === "Minted").length,
			5,
		);
		const rejected = results.filter((result) => result.outcome === "Rejected");
		assert.equal(rejected.length, 1);
		assert.equal(
			rejected[0].outcome === "Rejected" && rejected[0].rejection.reason,
			OutboxAttachmentRejectionReason.MessageTooLarge,
		);
		assert.ok((await heldBytes(storage)) <= OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES);
	});

	it("keeps the file-count ceiling when files are dropped in together", async () => {
		const { service, storage } = build();

		const results = await Promise.all(
			Array.from({ length: OUTBOX_ATTACHMENT_MAX_COUNT + 3 }, () =>
				mint(service, { sizeBytes: 1 }),
			),
		);

		assert.equal(
			results.filter((result) => result.outcome === "Minted").length,
			OUTBOX_ATTACHMENT_MAX_COUNT,
		);
		for (const result of results.filter(
			(candidate) => candidate.outcome === "Rejected",
		)) {
			assert.equal(
				result.outcome === "Rejected" && result.rejection.reason,
				OutboxAttachmentRejectionReason.TooManyAttachments,
			);
		}
		const { ledger } = await storage.readOutboxLedger(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			DRAFT_ID,
		);
		assert.equal(ledger.entries.length, OUTBOX_ATTACHMENT_MAX_COUNT);
	});

	it("lets two drafts reserve at the same time without waiting on each other", async () => {
		const { service } = build();

		const results = await Promise.all([
			service.mint({
				accountConfigId: ACCOUNT_CONFIG_ID,
				outboxMessageId: "draft-a",
				filename: "a.txt",
				contentType: "text/plain",
				sizeBytes: 1,
			}),
			service.mint({
				accountConfigId: ACCOUNT_CONFIG_ID,
				outboxMessageId: "draft-b",
				filename: "b.txt",
				contentType: "text/plain",
				sizeBytes: 1,
			}),
		]);

		assert.equal(
			results.filter((result) => result.outcome === "Minted").length,
			2,
		);
	});
});

describe("OutboxAttachmentService: an abandoned reservation", () => {
	it("stops holding room once it lapses, and the next mint takes the space", async () => {
		const clock = { seconds: 1_000_000 };
		const { service, storage } = build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);

		const abandoned = await mint(service, {
			filename: "walked-away.bin",
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024,
		});
		assert.equal(abandoned.outcome, "Minted");

		// Same instant, the draft is full.
		const blocked = await mint(service, { sizeBytes: 4096 });
		assert.equal(blocked.outcome, "Rejected");

		// Past the reservation's own expiry, the room comes back.
		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;

		const later = await mint(service, {
			filename: "later.bin",
			sizeBytes: 4096,
		});
		assert.equal(later.outcome, "Minted");
		assert.equal(await heldBytes(storage, clock.seconds), 4096);
	});

	it("stops vouching for bytes uploaded under it, and the sweep collects them", async () => {
		const clock = { seconds: 2_000_000 };
		const { service, storage } = build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);

		const minted = await mint(service, { sizeBytes: 32 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;

		// Uploaded, never confirmed — the shape a closed tab leaves behind.
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
			content: Buffer.alloc(32),
		});

		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;
		// The next mint stops counting the lapsed entry, so the room is back...
		await mint(service, { filename: "next.bin", sizeBytes: 8 });
		assert.equal(await heldBytes(storage, clock.seconds), 8);

		// ...and the bytes it left behind are what the sweep is for.
		const { deleted } = await sweepAbandonedOutboxAttachments(
			storage,
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			clock.seconds,
		);
		assert.equal(deleted, 1);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				minted.reservation.outboxAttachmentId,
			),
			null,
		);
	});
});

describe("OutboxAttachmentService: completing", () => {
	const uploadFor = async (
		storage: StorageService,
		outboxAttachmentId: string,
		sizeBytes: number,
	): Promise<void> => {
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId,
			content: Buffer.alloc(sizeBytes),
		});
	};

	it("believes storage about the size, not the client", async () => {
		const { service, storage } = build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 512);

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Completed");
		if (completed.outcome !== "Completed") return;
		assert.equal(completed.attachment.sizeBytes, 512);

		// The reservation is spent; the object is what the draft holds now.
		const { ledger } = await storage.readOutboxLedger(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			DRAFT_ID,
		);
		assert.deepEqual(
			ledger.entries.map((entry) => entry.uploaded),
			[true],
		);
		assert.equal(await heldBytes(storage), 512);
	});

	it("never completes an attachment whose object is absent", async () => {
		const { service } = build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Rejected");
		if (completed.outcome !== "Rejected") return;
		assert.equal(
			completed.rejection.reason,
			OutboxAttachmentRejectionReason.UploadMissing,
		);
	});

	it("refuses an object that is not the size reserved, and removes it", async () => {
		const { service, storage } = build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 4096);

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Rejected");
		if (completed.outcome !== "Rejected") return;
		assert.equal(
			completed.rejection.reason,
			OutboxAttachmentRejectionReason.SizeMismatch,
		);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				minted.reservation.outboxAttachmentId,
			),
			null,
		);
	});

	it("refuses a completion once the reservation has lapsed", async () => {
		const clock = { seconds: 3_000_000 };
		const { service, storage } = build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);
		const minted = await mint(service, { sizeBytes: 64 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 64);

		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Rejected");
		if (completed.outcome !== "Rejected") return;
		assert.equal(
			completed.rejection.reason,
			OutboxAttachmentRejectionReason.ReservationExpired,
		);
	});
});

describe("OutboxAttachmentService: discarding a draft's files", () => {
	it("removes every object and reservation stored against it", async () => {
		const { service, storage } = build();
		await Promise.all([
			mint(service, { filename: "one.txt" }),
			mint(service, { filename: "two.txt" }),
		]);

		await service.discardAll(ACCOUNT_CONFIG_ID, ACCOUNT_ID, DRAFT_ID);

		assert.deepEqual(
			await storage.listOutboxAttachments(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				200,
			),
			[],
		);
	});

	it("does not leave behind a reservation a mint was writing as it ran", async () => {
		const { service, storage } = build();

		await Promise.all([
			mint(service, { filename: "racing.txt" }),
			service.discardAll(ACCOUNT_CONFIG_ID, ACCOUNT_ID, DRAFT_ID),
		]);

		// Serialized, so either the mint landed and the sweep took it, or the
		// sweep ran first and the mint is the only thing there. Never a sweep that
		// stepped over a write in flight.
		const entries = await storage.listOutboxAttachments(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			DRAFT_ID,
			200,
		);
		assert.ok(entries.length <= 1);
	});

	it("is quiet on a draft that never held one", async () => {
		const { service } = build();
		await service.discardAll(ACCOUNT_CONFIG_ID, ACCOUNT_ID, "draft-untouched");
	});
});

describe("the cap across execution environments", () => {
	/**
	 * The hosted shape is Lambda: parallel mints land in separate execution
	 * environments that share storage and nothing else. Two service instances
	 * over one storage is that, and it is the case an in-process promise chain
	 * cannot see — so this is the test that fails if the ledger's compare-and-set
	 * stops being conditional.
	 */
	const twoEnvironments = (): {
		first: OutboxAttachmentService;
		second: OutboxAttachmentService;
		storage: StorageService;
	} => {
		const shared = withScheduling(createMockStorageService());
		const outboxMessageService = {
			get: async () =>
				({
					outboxMessageId: DRAFT_ID,
					accountId: ACCOUNT_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
					status: OutboxMessageStatus.draft,
				}) as OutboxMessageItem,
		} as unknown as IOutboxMessageRepository;

		return {
			first: new OutboxAttachmentService({
				outboxMessageService,
				storage: shared,
			}),
			second: new OutboxAttachmentService({
				outboxMessageService,
				storage: shared,
			}),
			storage: shared,
		};
	};

	it("holds when two processes mint against the same draft at once", async () => {
		const { first, second, storage } = twoEnvironments();
		const twentyMegabytes = 20 * 1024 * 1024;

		const [a, b] = await Promise.all([
			mint(first, { filename: "a.bin", sizeBytes: twentyMegabytes }),
			mint(second, { filename: "b.bin", sizeBytes: twentyMegabytes }),
		]);

		// 40 MB against a 25 MB cap: exactly one may win, whichever gets there.
		const minted = [a, b].filter((result) => result.outcome === "Minted");
		const rejected = [a, b].filter((result) => result.outcome === "Rejected");
		assert.equal(minted.length, 1);
		assert.equal(rejected.length, 1);
		assert.equal(
			rejected[0].outcome === "Rejected" && rejected[0].rejection.reason,
			OutboxAttachmentRejectionReason.MessageTooLarge,
		);
		assert.ok((await heldBytes(storage)) <= OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES);
	});

	it("holds the file-count ceiling across processes too", async () => {
		const { first, second, storage } = twoEnvironments();

		const results = await Promise.all(
			Array.from({ length: OUTBOX_ATTACHMENT_MAX_COUNT + 6 }, (_, index) =>
				mint(index % 2 === 0 ? first : second, { sizeBytes: 1 }),
			),
		);

		assert.equal(
			results.filter((result) => result.outcome === "Minted").length,
			OUTBOX_ATTACHMENT_MAX_COUNT,
		);
		const { ledger } = await storage.readOutboxLedger(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			DRAFT_ID,
		);
		assert.equal(ledger.entries.length, OUTBOX_ATTACHMENT_MAX_COUNT);
	});
});
