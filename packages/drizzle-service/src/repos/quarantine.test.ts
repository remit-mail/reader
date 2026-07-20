import assert from "node:assert";
import { after, before, describe, test } from "node:test";
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
			uid: 40217,
			mailboxPath: "INBOX",
			quarantinedAt: now,
			attempts: 3,
			failureStage: "BodyParse",
			failureCode: "UnterminatedMultipartBoundary",
			failureMessage: "multipart boundary was never closed",
			workerVersion: "worker 1.0.0",
			contentType: "multipart/mixed",
			transferEncoding: "7bit",
			sizeBytes: 184_233,
			structure: [{ depth: 0, contentType: "multipart/mixed" }],
			messageIdHash: "sha256:6f1c4a9d20",
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
	});
});
