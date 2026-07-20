import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { deriveQuarantineId } from "@remit/data-ports/id";
import { quarantineTable } from "../schema/quarantine.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { QuarantineRepo } from "./quarantine.js";

describe("QuarantineRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: QuarantineRepo;

	const seed = async (
		overrides: Partial<typeof quarantineTable.$inferInsert> & {
			accountConfigId: string;
		},
	): Promise<string> => {
		const quarantineId = randomId();
		const now = Date.now();
		await db.insert(quarantineTable).values({
			quarantineId,
			accountId: randomId(),
			mailboxId: randomId(),
			uidValidity: 1_712_000_000,
			uid: 40217,
			mailboxPath: "INBOX",
			quarantinedAt: now,
			attempts: 3,
			failureStage: "BodyParse",
			failureCode: "UnreadableBody",
			failureMessage: "multipart boundary was never closed",
			workerVersion: "worker 1.0.0",
			structure: [{ depth: 0, contentType: "multipart/mixed" }],
			createdAt: now,
			updatedAt: now,
			...overrides,
		});
		return quarantineId;
	};

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new QuarantineRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("lists one user's entries newest first", async () => {
		const accountConfigId = randomId();
		const older = await seed({ accountConfigId, quarantinedAt: 1_000 });
		const newer = await seed({ accountConfigId, quarantinedAt: 2_000 });

		const entries = await repo.listByAccountConfigId(accountConfigId);

		assert.deepEqual(
			entries.map((entry) => entry.quarantineId),
			[newer, older],
		);
	});

	test("never returns another user's entries", async () => {
		const mine = randomId();
		await seed({ accountConfigId: mine });
		await seed({ accountConfigId: randomId() });

		const entries = await repo.listByAccountConfigId(mine);

		assert.equal(entries.length, 1);
		assert.equal(entries[0].accountConfigId, mine);
	});

	test("returns the MIME tree as the pre-order walk it was written as", async () => {
		const accountConfigId = randomId();
		await seed({
			accountConfigId,
			structure: [
				{ depth: 0, contentType: "multipart/mixed" },
				{ depth: 1, contentType: "text/plain" },
				{ depth: 1, contentType: "application/pdf" },
			],
		});

		const [entry] = await repo.listByAccountConfigId(accountConfigId);

		assert.deepEqual(entry.structure, [
			{ depth: 0, contentType: "multipart/mixed" },
			{ depth: 1, contentType: "text/plain" },
			{ depth: 1, contentType: "application/pdf" },
		]);
	});

	test("carries the optional diagnostics as absent, not null", async () => {
		const accountConfigId = randomId();
		await seed({ accountConfigId });

		const [entry] = await repo.listByAccountConfigId(accountConfigId);

		// A folder nobody appointed a role to, a whole-body failure and an
		// undeclared charset are all ordinary. The API contract makes them
		// optional, so a null row value must not leak through as `null`.
		assert.equal(entry.mailboxRole, undefined);
		assert.equal(entry.failurePartPath, undefined);
		assert.equal(entry.charset, undefined);
		// The message-shape fields come off one optional BODYSTRUCTURE, so a
		// message that failed before it was read carries none of them.
		assert.equal(entry.contentType, undefined);
		assert.equal(entry.transferEncoding, undefined);
		assert.equal(entry.sizeBytes, undefined);
		assert.equal(entry.messageIdHash, undefined);
	});

	test("re-quarantining the same message rewrites one row, never adds another", async () => {
		const accountConfigId = randomId();
		const identity = {
			accountConfigId,
			accountId: randomId(),
			mailboxId: randomId(),
			uidValidity: 1_712_000_000,
			uid: 40217,
			mailboxPath: "INBOX",
			attempts: 1,
			failureStage: "BodyParse" as const,
			failureCode: "UnreadableBody" as const,
			failureMessage: "the parser said no",
			workerVersion: "sha-abc",
		};

		await repo.upsert({ ...identity, quarantinedAt: 1_000 });
		await repo.upsert({ ...identity, quarantinedAt: 2_000, attempts: 4 });

		const entries = await repo.listByAccountConfigId(accountConfigId);

		assert.equal(entries.length, 1);
		assert.equal(entries[0].attempts, 4);
		assert.equal(entries[0].quarantinedAt, 2_000);
	});

	test("keeps the id derived from the message, not the random column default", async () => {
		const accountConfigId = randomId();
		const identity = {
			accountConfigId,
			accountId: randomId(),
			mailboxId: randomId(),
			uidValidity: 1_712_000_000,
			uid: 40217,
			mailboxPath: "INBOX",
			quarantinedAt: 1_000,
			attempts: 1,
			failureStage: "BodyParse" as const,
			failureCode: "UnreadableBody" as const,
			failureMessage: "the parser said no",
			workerVersion: "sha-abc",
		};

		await repo.upsert(identity);
		const [entry] = await repo.listByAccountConfigId(accountConfigId);

		assert.equal(
			entry.quarantineId,
			deriveQuarantineId(
				identity.accountId,
				identity.mailboxId,
				identity.uidValidity,
				identity.uid,
			),
		);
	});

	test("defaults the MIME tree to empty when the message failed before its shape was read", async () => {
		const accountConfigId = randomId();
		await repo.upsert({
			accountConfigId,
			accountId: randomId(),
			mailboxId: randomId(),
			uidValidity: 1_712_000_000,
			uid: 1,
			mailboxPath: "INBOX",
			quarantinedAt: 1_000,
			attempts: 1,
			failureStage: "MessageEnvelope",
			failureCode: "MissingEnvelope",
			failureMessage: "FETCH returned the message with no ENVELOPE",
			workerVersion: "sha-abc",
		});

		const [entry] = await repo.listByAccountConfigId(accountConfigId);

		assert.deepEqual(entry.structure, []);
	});
});
