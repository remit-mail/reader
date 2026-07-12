import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { MessageLabelRepo } from "./message-label.js";

describe("MessageLabelRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MessageLabelRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MessageLabelRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("apply is idempotent — the same (messageId, labelId) always derives the same row", async () => {
		const accountConfigId = randomId();
		const messageId = randomId();
		const labelId = randomId();

		const first = await repo.apply({ accountConfigId, messageId, labelId });
		const second = await repo.apply({ accountConfigId, messageId, labelId });

		assert.equal(first.messageLabelId, second.messageLabelId);
		assert.equal(
			first.messageLabelId,
			MessageLabelRepo.deriveId(messageId, labelId),
		);

		const rows = await repo.listByMessageId(messageId);
		assert.equal(rows.length, 1);
	});

	test("appliedByFilterId is absent for a manually-applied label", async () => {
		const accountConfigId = randomId();
		const messageId = randomId();
		const labelId = randomId();

		const row = await repo.apply({ accountConfigId, messageId, labelId });

		assert.equal(row.appliedByFilterId, undefined);
	});

	test("appliedByFilterId round-trips for a filter-applied label (RFC 034 Decision 3.3)", async () => {
		const accountConfigId = randomId();
		const messageId = randomId();
		const labelId = randomId();
		const appliedByFilterId = randomId();

		const row = await repo.apply({
			accountConfigId,
			messageId,
			labelId,
			appliedByFilterId,
		});

		assert.equal(row.appliedByFilterId, appliedByFilterId);
	});

	test("remove deletes the derived row", async () => {
		const accountConfigId = randomId();
		const messageId = randomId();
		const labelId = randomId();

		await repo.apply({ accountConfigId, messageId, labelId });
		await repo.remove(messageId, labelId);

		const labels = await repo.listByMessageId(messageId);
		assert.equal(labels.length, 0);
	});

	test("listByMessageId returns every label on a message", async () => {
		const accountConfigId = randomId();
		const messageId = randomId();
		const labelIdA = randomId();
		const labelIdB = randomId();

		await repo.apply({ accountConfigId, messageId, labelId: labelIdA });
		await repo.apply({ accountConfigId, messageId, labelId: labelIdB });

		const labels = await repo.listByMessageId(messageId);
		const ids = labels.map((l) => l.labelId).sort();
		assert.deepEqual(ids, [labelIdA, labelIdB].sort());
	});

	test("listByLabelId scopes to the account and label", async () => {
		const accountConfigId = randomId();
		const labelId = randomId();
		const messageIdA = randomId();
		const messageIdB = randomId();
		const foreignAccountConfigId = randomId();
		const foreignMessageId = randomId();

		await repo.apply({ accountConfigId, messageId: messageIdA, labelId });
		await repo.apply({ accountConfigId, messageId: messageIdB, labelId });
		await repo.apply({
			accountConfigId: foreignAccountConfigId,
			messageId: foreignMessageId,
			labelId,
		});

		const rows = await repo.listByLabelId(accountConfigId, labelId);
		const messageIds = rows.map((r) => r.messageId).sort();
		assert.deepEqual(messageIds, [messageIdA, messageIdB].sort());
	});
});
