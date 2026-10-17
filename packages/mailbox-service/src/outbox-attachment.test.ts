import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { OutboxMessageItem } from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	type StorageService,
	UPLOAD_URL_TTL_SECONDS,
} from "@remit/storage-service";
import {
	OUTBOX_ATTACHMENT_MAX_COUNT,
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	OutboxAttachmentService,
} from "./outbox-attachment.js";
import { openStore, type Store } from "./test-helpers/test-store.js";

const ACCOUNT_CONFIG_ID = "cfg-679";
const ACCOUNT_ID = "acc-679";

let store: Store;
let draftId: string;

afterEach(() => store?.close());

const build = async (
	status: OutboxMessageItem["status"] = OutboxMessageStatus.draft,
	now?: () => number,
) => {
	store = await openStore();
	const storage = store.storage();
	const draft = await store.outboxMessage.create({
		accountId: ACCOUNT_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		fromAddress: "me@example.com",
		toAddresses: ["them@example.com"],
		messageIdValue: "<draft@example.com>",
		status,
	});
	draftId = draft.outboxMessageId;
	return {
		service: new OutboxAttachmentService({
			outboxMessageService: store.outboxMessage,
			outboxAttachmentService: store.outboxAttachment,
			storage,
			now,
		}),
		storage,
	};
};

const rows = () =>
	store.outboxAttachment.listByOutboxMessage(ACCOUNT_CONFIG_ID, draftId);

const rowOf = (outboxAttachmentId: string) =>
	store.outboxAttachment.get(ACCOUNT_CONFIG_ID, outboxAttachmentId);

const ids = async () => (await rows()).map((row) => row.outboxAttachmentId);

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
		outboxMessageId: draftId,
		filename: overrides.filename ?? "notes.txt",
		contentType: overrides.contentType ?? "text/plain",
		sizeBytes: overrides.sizeBytes ?? 10,
	});

const uploadFor = (
	storage: StorageService,
	outboxAttachmentId: string,
	sizeBytes: number,
) =>
	storage.storeOutboxAttachment({
		accountConfigId: ACCOUNT_CONFIG_ID,
		accountId: ACCOUNT_ID,
		outboxMessageId: draftId,
		outboxAttachmentId,
		content: Buffer.alloc(sizeBytes),
	});

describe("reserving room on a draft", () => {
	it("writes a Pending row and hands back a URL bound to its size", async () => {
		const { service } = await build();

		const result = await mint(service, {
			filename: "invoice.pdf",
			contentType: "application/pdf",
			sizeBytes: 2048,
		});

		assert.equal(result.outcome, "Minted");
		if (result.outcome !== "Minted") return;
		assert.equal(result.reservation.filename, "invoice.pdf");
		assert.equal(result.reservation.contentType, "application/pdf");
		assert.match(result.reservation.uploadUrl, /max=2048/);

		const row = await rowOf(result.reservation.outboxAttachmentId);
		assert.equal(row?.state, "Pending");
		assert.equal(row?.sizeBytes, 2048);
		// The key on the row is the one the URL addresses — one identity, not two.
		assert.ok(row?.storageKey.endsWith(result.reservation.outboxAttachmentId));
	});

	it("names the content-id a body can refer to the file by", async () => {
		const { service } = await build();

		const result = await mint(service, {
			filename: "shot.png",
			contentType: "image/png",
			sizeBytes: 64,
		});

		assert.equal(result.outcome, "Minted");
		if (result.outcome !== "Minted") return;
		assert.equal(
			result.reservation.contentId,
			`${result.reservation.outboxAttachmentId}@remit`,
		);
	});

	it("refuses a declared size over the cap", async () => {
		const { service } = await build();

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
	});

	it("counts a reservation nobody has uploaded against yet", async () => {
		const { service } = await build();
		await mint(service, {
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024,
		});

		const result = await mint(service, { sizeBytes: 4096 });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.MessageTooLarge,
		);
		assert.equal(
			result.rejection.usedBytes,
			OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024,
		);
	});

	it("refuses once the draft holds the most files a message can", async () => {
		const { service } = await build();
		for (let index = 0; index < OUTBOX_ATTACHMENT_MAX_COUNT; index += 1) {
			await mint(service, { sizeBytes: 1 });
		}

		const result = await mint(service, { sizeBytes: 1 });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.TooManyAttachments,
		);
	});

	it("refuses a file declared as empty, and a filename that sanitizes away", async () => {
		const { service } = await build();

		const empty = await mint(service, { sizeBytes: 0 });
		assert.equal(
			empty.outcome === "Rejected" && empty.rejection.reason,
			OutboxAttachmentRejectionReason.EmptyFile,
		);

		const unnamed = await mint(service, { filename: "../.." });
		assert.equal(
			unnamed.outcome === "Rejected" && unnamed.rejection.reason,
			OutboxAttachmentRejectionReason.UnusableFilename,
		);
	});

	it("records a filename stripped of its path and a media type it cannot read", async () => {
		const { service } = await build();

		const result = await mint(service, {
			filename: "../../etc/passwd",
			contentType: "",
		});

		assert.equal(result.outcome, "Minted");
		if (result.outcome !== "Minted") return;
		assert.equal(result.reservation.filename, "passwd");
		assert.equal(result.reservation.contentType, "application/octet-stream");
	});

	it("stops holding room once the reservation lapses", async () => {
		const clock = { seconds: 1_000_000 };
		const { service } = await build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);
		await mint(service, {
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024,
		});

		assert.equal(
			(await mint(service, { sizeBytes: 4096 })).outcome,
			"Rejected",
		);

		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;

		assert.equal((await mint(service, { sizeBytes: 4096 })).outcome, "Minted");
	});

	it("denies a mint against a draft owned by someone else", async () => {
		const { service } = await build();

		await assert.rejects(
			() => mint(service, { accountConfigId: "cfg-stranger" }),
			ForbiddenError,
		);
		assert.equal((await rows()).length, 0);
	});

	it("refuses to reserve on a message that has left draft", async () => {
		const { service } = await build(OutboxMessageStatus.queued);

		await assert.rejects(() => mint(service), {
			name: "ConflictError",
			message: /no longer take an attachment/,
		});
	});
});

describe("the cap under concurrency", () => {
	/**
	 * Nothing in this service serializes anything, and nothing needs to: the
	 * repository counts and inserts in one transaction, so parallel mints — in
	 * this process or six others — are ordered by the database. These would fail
	 * if `reserve` ever grew an await between its count and its insert.
	 */
	it("holds the byte cap when files are dropped in together", async () => {
		const { service } = await build();
		const fiveMegabytes = 5 * 1024 * 1024;

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
	});

	it("holds the file-count ceiling when files are dropped in together", async () => {
		const { service } = await build();

		const results = await Promise.all(
			Array.from({ length: OUTBOX_ATTACHMENT_MAX_COUNT + 5 }, () =>
				mint(service, { sizeBytes: 1 }),
			),
		);

		assert.equal(
			results.filter((result) => result.outcome === "Minted").length,
			OUTBOX_ATTACHMENT_MAX_COUNT,
		);
		assert.equal((await rows()).length, OUTBOX_ATTACHMENT_MAX_COUNT);
	});
});

describe("completing an attachment", () => {
	it("believes storage about the size and moves the row to Stored", async () => {
		const { service, storage } = await build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 512);

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Completed");
		if (completed.outcome !== "Completed") return;
		assert.equal(completed.attachment.sizeBytes, 512);
		assert.equal(completed.attachment.state, "Stored");
		assert.equal(
			(await rowOf(minted.reservation.outboxAttachmentId))
				?.reservationExpiresAt,
			0,
		);
	});

	it("answers a repeated completion the same way, not with an error", async () => {
		const { service, storage } = await build();
		const minted = await mint(service, { sizeBytes: 64 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 64);

		const input = {
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		};
		const first = await service.complete(input);
		const second = await service.complete(input);

		assert.equal(first.outcome, "Completed");
		assert.equal(second.outcome, "Completed");
		assert.deepEqual(
			first.outcome === "Completed" && first.attachment,
			second.outcome === "Completed" && second.attachment,
		);
	});

	it("never completes an attachment whose object is absent", async () => {
		const { service } = await build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(
			completed.outcome === "Rejected" && completed.rejection.reason,
			OutboxAttachmentRejectionReason.UploadMissing,
		);
	});

	it("refuses a wrong-sized object, removes it, and gives the room back", async () => {
		const { service, storage } = await build();
		const minted = await mint(service, { sizeBytes: 512 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 4096);

		const completed = await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(completed.outcome, "Rejected");
		if (completed.outcome !== "Rejected") return;
		assert.equal(
			completed.rejection.reason,
			OutboxAttachmentRejectionReason.SizeMismatch,
		);
		// The room the reservation held is reported as released, not as still held.
		assert.equal(completed.rejection.usedBytes, 0);
		assert.equal((await rows()).length, 0);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				minted.reservation.outboxAttachmentId,
			),
			null,
		);
	});

	it("refuses a completion once the reservation has lapsed", async () => {
		const clock = { seconds: 3_000_000 };
		const { service, storage } = await build(
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
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		assert.equal(
			completed.outcome === "Rejected" && completed.rejection.reason,
			OutboxAttachmentRejectionReason.ReservationExpired,
		);
	});
});

describe("removing and discarding", () => {
	it("retainOnly drops the rows and the bytes it was not told to keep", async () => {
		const { service, storage } = await build();
		const kept = await mint(service, { filename: "keep.txt", sizeBytes: 8 });
		const dropped = await mint(service, { filename: "drop.txt", sizeBytes: 8 });
		assert.equal(kept.outcome, "Minted");
		assert.equal(dropped.outcome, "Minted");
		if (kept.outcome !== "Minted" || dropped.outcome !== "Minted") return;
		await uploadFor(storage, dropped.reservation.outboxAttachmentId, 8);

		await service.retainOnly(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId, [
			kept.reservation.outboxAttachmentId,
		]);

		assert.deepEqual(await ids(), [kept.reservation.outboxAttachmentId]);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				dropped.reservation.outboxAttachmentId,
			),
			null,
		);
	});

	it("discardAll takes every row and every object", async () => {
		const { service, storage } = await build();
		const minted = await mint(service, { sizeBytes: 8 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 8);

		await service.discardAll(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId);

		assert.equal((await rows()).length, 0);
		assert.deepEqual(
			await storage.listOutboxAttachments(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
			),
			[],
		);
	});
});

describe("retainOnly, which is what attachmentIds drives", () => {
	const mintTwo = async (service: OutboxAttachmentService) => {
		const first = await mint(service, { filename: "one.txt", sizeBytes: 8 });
		const second = await mint(service, { filename: "two.txt", sizeBytes: 8 });
		assert.equal(first.outcome, "Minted");
		assert.equal(second.outcome, "Minted");
		if (first.outcome !== "Minted" || second.outcome !== "Minted") {
			throw new Error("unreachable");
		}
		return [first.reservation, second.reservation] as const;
	};

	it("keeps everything named and removes everything else, bytes included", async () => {
		const { service, storage } = await build();
		const [keep, drop] = await mintTwo(service);
		await uploadFor(storage, keep.outboxAttachmentId, 8);
		await uploadFor(storage, drop.outboxAttachmentId, 8);

		await service.retainOnly(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId, [
			keep.outboxAttachmentId,
		]);

		assert.deepEqual(await ids(), [keep.outboxAttachmentId]);
		assert.ok(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				keep.outboxAttachmentId,
			),
		);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				drop.outboxAttachmentId,
			),
			null,
		);
	});

	it("an empty list is a real instruction: everything goes", async () => {
		const { service, storage } = await build();
		const [first] = await mintTwo(service);
		await uploadFor(storage, first.outboxAttachmentId, 8);

		await service.retainOnly(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId, []);

		assert.equal((await rows()).length, 0);
		assert.deepEqual(
			await storage.listOutboxAttachments(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
			),
			[],
		);
	});

	it("naming every id changes nothing", async () => {
		const { service } = await build();
		const [first, second] = await mintTwo(service);

		await service.retainOnly(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId, [
			first.outboxAttachmentId,
			second.outboxAttachmentId,
		]);

		assert.equal((await rows()).length, 2);
	});

	it("an id the draft never held is a no-op, not a removal of the rest", async () => {
		const { service } = await build();
		const [first, second] = await mintTwo(service);

		await service.retainOnly(ACCOUNT_CONFIG_ID, ACCOUNT_ID, draftId, [
			first.outboxAttachmentId,
			second.outboxAttachmentId,
			"never-existed",
		]);

		assert.equal((await rows()).length, 2);
	});
});

describe("a reservation that lapses without ever completing", () => {
	it("is reaped, so the sweep can collect the bytes it was vouching for", async () => {
		const clock = { seconds: 5_000_000 };
		const { service, storage } = await build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);
		const minted = await mint(service, { sizeBytes: 32 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		// Uploaded, never confirmed — the shape a closed tab leaves behind.
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 32);

		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;

		// Before the reap the row still names the object, which is enough for the
		// sweep to leave it alone forever.
		const live = await service.reapAndListLive(ACCOUNT_CONFIG_ID, draftId);

		assert.deepEqual(live, []);
		assert.equal((await rows()).length, 0);
	});

	it("is not shown to the composer as a file the draft holds", async () => {
		const clock = { seconds: 6_000_000 };
		const { service } = await build(
			OutboxMessageStatus.draft,
			() => clock.seconds,
		);
		await mint(service, { sizeBytes: 32 });

		assert.equal((await service.listFor(ACCOUNT_CONFIG_ID, draftId)).length, 1);

		clock.seconds += UPLOAD_URL_TTL_SECONDS + 1;

		assert.deepEqual(await service.listFor(ACCOUNT_CONFIG_ID, draftId), []);
	});

	it("a confirmed attachment cannot be overwritten through its old URL", async () => {
		const { service, storage } = await build();
		const minted = await mint(service, { sizeBytes: 16 });
		assert.equal(minted.outcome, "Minted");
		if (minted.outcome !== "Minted") return;
		await uploadFor(storage, minted.reservation.outboxAttachmentId, 16);

		assert.equal(
			await service.hasLiveReservation(
				ACCOUNT_CONFIG_ID,
				minted.reservation.outboxAttachmentId,
			),
			true,
		);

		await service.complete({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId: draftId,
			outboxAttachmentId: minted.reservation.outboxAttachmentId,
		});

		// The URL stays signed for the rest of its window; the row is what refuses.
		assert.equal(
			await service.hasLiveReservation(
				ACCOUNT_CONFIG_ID,
				minted.reservation.outboxAttachmentId,
			),
			false,
		);
	});
});
