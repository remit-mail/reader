import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { MessagePlacementMoveRepo } from "./i4-message-placement-move.js";

describe("MessagePlacementMoveRepo (Postgres counterpart to MessagePlacementMoveService)", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MessagePlacementMoveRepo;

	const seedInput = (
		overrides: Partial<{
			messageId: string;
			accountId: string;
			accountConfigId: string;
			sourceMailboxId: string;
			destinationMailboxId: string;
		}> = {},
	) => ({
		messageId: randomId(),
		accountId: randomId(),
		accountConfigId: randomId(),
		sourceMailboxId: randomId(),
		destinationMailboxId: randomId(),
		...overrides,
	});

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MessagePlacementMoveRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("find returns null when no marker exists — the normal steady state", async () => {
		const found = await repo.find(randomId());
		assert.equal(found, null);
	});

	test("put then find round-trips the marker, using the given messageId as the primary key, defaulting state to pending", async () => {
		const input = seedInput();
		await repo.put(input);

		const found = await repo.find(input.messageId);
		assert.ok(found);
		assert.equal(found?.messageId, input.messageId);
		assert.equal(found?.sourceMailboxId, input.sourceMailboxId);
		assert.equal(found?.destinationMailboxId, input.destinationMailboxId);
		assert.equal(found?.state, "pending");
	});

	test("updateState advances the state engine without touching other fields", async () => {
		const input = seedInput();
		await repo.put(input);

		const queued = await repo.updateState(input.messageId, "queued");
		assert.equal(queued.state, "queued");
		assert.equal(queued.destinationMailboxId, input.destinationMailboxId);

		const processing = await repo.updateState(input.messageId, "processing");
		assert.equal(processing.state, "processing");

		const found = await repo.find(input.messageId);
		assert.equal(found?.state, "processing");
	});

	test("updateState throws on a marker that does not exist", async () => {
		await assert.rejects(() => repo.updateState(randomId(), "queued"));
	});

	test("put resets state back to pending — a fresh decision always starts a new lifecycle", async () => {
		const input = seedInput();
		await repo.put(input);
		await repo.updateState(input.messageId, "processing");

		await repo.put(seedInput({ messageId: input.messageId }));

		const found = await repo.find(input.messageId);
		assert.equal(found?.state, "pending");
	});

	test("put is idempotent — a later decision replaces the marker (later intent wins locally)", async () => {
		const messageId = randomId();
		const firstDestination = randomId();
		const secondDestination = randomId();

		await repo.put(
			seedInput({ messageId, destinationMailboxId: firstDestination }),
		);
		await repo.put(
			seedInput({ messageId, destinationMailboxId: secondDestination }),
		);

		const found = await repo.find(messageId);
		assert.equal(found?.destinationMailboxId, secondDestination);
	});

	test("delete clears the marker (confirmed move / superseded / external delete)", async () => {
		const input = seedInput();
		await repo.put(input);
		await repo.delete(input.messageId);

		const found = await repo.find(input.messageId);
		assert.equal(found, null);
	});

	test("delete on an absent marker is a no-op, never throws", async () => {
		await assert.doesNotReject(() => repo.delete(randomId()));
	});

	test("listByAccountId returns every pending marker for the account, none for another", async () => {
		const accountId = randomId();
		const otherAccountId = randomId();

		const first = seedInput({ accountId });
		const second = seedInput({ accountId });
		const foreign = seedInput({ accountId: otherAccountId });

		await repo.put(first);
		await repo.put(second);
		await repo.put(foreign);

		const markers = await repo.listByAccountId(accountId);
		const messageIds = markers.map((m) => m.messageId).sort();

		assert.deepEqual(messageIds, [first.messageId, second.messageId].sort());
	});

	test("listByAccountId returns an empty list for an account with no pending moves", async () => {
		const markers = await repo.listByAccountId(randomId());
		assert.deepEqual(markers, []);
	});
});
