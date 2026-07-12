import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { MessageFlagPushRepo } from "./i4-message-flag-push.js";

describe("MessageFlagPushRepo (Postgres counterpart to MessageFlagPushService)", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MessageFlagPushRepo;

	const seedInput = (
		overrides: Partial<{
			messageId: string;
			flagName: string;
			accountId: string;
			accountConfigId: string;
			mailboxId: string;
			operation: "add" | "remove";
		}> = {},
	) => ({
		messageId: randomId(),
		flagName: "\\Seen",
		accountId: randomId(),
		accountConfigId: randomId(),
		mailboxId: randomId(),
		operation: "add" as const,
		...overrides,
	});

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MessageFlagPushRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("find returns null when no marker exists — the normal steady state", async () => {
		const found = await repo.find(randomId(), "\\Seen");
		assert.equal(found, null);
	});

	test("put then find round-trips the marker, using the composite (messageId, flagName) key, defaulting state to pending", async () => {
		const input = seedInput();
		await repo.put(input);

		const found = await repo.find(input.messageId, input.flagName);
		assert.ok(found);
		assert.equal(found?.messageId, input.messageId);
		assert.equal(found?.flagName, input.flagName);
		assert.equal(found?.mailboxId, input.mailboxId);
		assert.equal(found?.operation, "add");
		assert.equal(found?.state, "pending");
	});

	test("a pending Seen marker and a pending Flagged marker on the SAME message coexist independently", async () => {
		const messageId = randomId();
		await repo.put(
			seedInput({ messageId, flagName: "\\Seen", operation: "add" }),
		);
		await repo.put(
			seedInput({ messageId, flagName: "\\Flagged", operation: "remove" }),
		);

		const seenMarker = await repo.find(messageId, "\\Seen");
		const starMarker = await repo.find(messageId, "\\Flagged");

		assert.equal(seenMarker?.operation, "add");
		assert.equal(starMarker?.operation, "remove");

		await repo.put(
			seedInput({ messageId, flagName: "\\Seen", operation: "remove" }),
		);
		const starMarkerAfter = await repo.find(messageId, "\\Flagged");
		assert.equal(
			starMarkerAfter?.operation,
			"remove",
			"the star marker must survive a later flip of the read-state field",
		);
	});

	test("updateState advances the state engine without touching other fields", async () => {
		const input = seedInput();
		await repo.put(input);

		const queued = await repo.updateState(
			input.messageId,
			input.flagName,
			"queued",
		);
		assert.equal(queued.state, "queued");
		assert.equal(queued.operation, input.operation);

		const processing = await repo.updateState(
			input.messageId,
			input.flagName,
			"processing",
		);
		assert.equal(processing.state, "processing");

		const found = await repo.find(input.messageId, input.flagName);
		assert.equal(found?.state, "processing");
	});

	test("updateState throws on a marker that does not exist", async () => {
		await assert.rejects(() =>
			repo.updateState(randomId(), "\\Seen", "queued"),
		);
	});

	test("put resets state back to pending — a fresh flip always starts a new lifecycle", async () => {
		const input = seedInput();
		await repo.put(input);
		await repo.updateState(input.messageId, input.flagName, "processing");

		await repo.put(
			seedInput({ messageId: input.messageId, flagName: input.flagName }),
		);

		const found = await repo.find(input.messageId, input.flagName);
		assert.equal(found?.state, "pending");
	});

	test("put is idempotent — a later flip of the SAME field replaces the marker", async () => {
		const messageId = randomId();
		const flagName = "\\Seen";

		await repo.put(seedInput({ messageId, flagName, operation: "add" }));
		await repo.put(seedInput({ messageId, flagName, operation: "remove" }));

		const found = await repo.find(messageId, flagName);
		assert.equal(found?.operation, "remove");
	});

	test("delete clears the marker (confirmed push / external delete)", async () => {
		const input = seedInput();
		await repo.put(input);
		await repo.delete(input.messageId, input.flagName);

		const found = await repo.find(input.messageId, input.flagName);
		assert.equal(found, null);
	});

	test("delete on an absent marker is a no-op, never throws", async () => {
		await assert.doesNotReject(() => repo.delete(randomId(), "\\Seen"));
	});

	test("listByAccountId returns every pending marker for the account, none for another", async () => {
		const accountId = randomId();
		const otherAccountId = randomId();

		const first = seedInput({ accountId });
		const second = seedInput({ accountId, flagName: "\\Flagged" });
		const foreign = seedInput({ accountId: otherAccountId });

		await repo.put(first);
		await repo.put(second);
		await repo.put(foreign);

		const markers = await repo.listByAccountId(accountId);
		const messageIds = markers.map((m) => m.messageId).sort();

		assert.deepEqual(messageIds, [first.messageId, second.messageId].sort());
	});

	test("listByAccountId returns an empty list for an account with no pending pushes", async () => {
		const markers = await repo.listByAccountId(randomId());
		assert.deepEqual(markers, []);
	});

	test("listByMailboxId returns every pending marker for the mailbox, none for another", async () => {
		const mailboxId = randomId();
		const otherMailboxId = randomId();

		const first = seedInput({ mailboxId });
		const second = seedInput({ mailboxId, flagName: "\\Flagged" });
		const foreign = seedInput({ mailboxId: otherMailboxId });

		await repo.put(first);
		await repo.put(second);
		await repo.put(foreign);

		const markers = await repo.listByMailboxId(mailboxId);
		const messageIds = markers.map((m) => m.messageId).sort();

		assert.deepEqual(messageIds, [first.messageId, second.messageId].sort());
	});
});
