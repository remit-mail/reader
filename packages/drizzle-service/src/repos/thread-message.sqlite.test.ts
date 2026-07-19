import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleThreadMessageRepository } from "./thread-message.js";

// The thread-message repo on sqlite (RFC 036 D1): CRUD, keyset pagination, and
// text search — the FTS5 trigram index for terms of three characters or more
// (D4), the folded-LIKE scan for shorter terms. The search contract is accent-
// and case-insensitive substring match over subject and sender.

const ACCOUNT = "acct-thread";
const MAILBOX = "mbx-thread";

function makeInput(
	overrides: Partial<CreateThreadMessageInput> = {},
): CreateThreadMessageInput {
	const now = Date.now();
	return {
		accountConfigId: ACCOUNT,
		threadId: `t-${Math.random().toString(36).slice(2)}`,
		messageId: `m-${Math.random().toString(36).slice(2)}`,
		mailboxId: MAILBOX,
		uid: 1,
		referenceOrder: 0,
		internalDate: now,
		sentDate: now,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		...overrides,
	};
}

describe("DrizzleThreadMessageRepository (sqlite)", () => {
	let db: Awaited<ReturnType<typeof createSqliteTestDb>>["db"];
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;

	before(async () => {
		({ db, close } = await createSqliteTestDb(
			{
				threadMessage: threadMessageTable,
			},
			{ searchIndex: true },
		));
		repo = new DrizzleThreadMessageRepository(db);
	});

	after(async () => {
		await close();
	});

	test("create then get round-trips", async () => {
		const created = await repo.create(
			makeInput({ subject: "Hello world", fromEmail: "a@example.com" }),
		);
		const got = await repo.get(ACCOUNT, created.threadMessageId);
		assert.equal(got.subject, "Hello world");
		assert.equal(got.isRead, false);
	});

	test("search matches a case-insensitive substring of the subject", async () => {
		await repo.create(makeInput({ subject: "Invoice for March" }));
		await repo.create(makeInput({ subject: "unrelated note" }));

		const result = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "invoice" },
			{ count: 50 },
		);
		assert.ok(
			result.items.every((i) => /invoice/i.test(i.subject ?? "")),
			"every match contains the needle",
		);
		assert.ok(
			result.items.some((i) => i.subject === "Invoice for March"),
			"the matching subject is returned",
		);
	});

	test("search matches the sender fields", async () => {
		await repo.create(
			makeInput({
				subject: "x",
				fromName: "Alice Kramer",
				fromEmail: "alice@corp.test",
			}),
		);
		const byName = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ from: "kramer" },
			{ count: 50 },
		);
		assert.ok(byName.items.some((i) => i.fromName === "Alice Kramer"));
	});

	test("FTS trigram search folds diacritics both ways", async () => {
		await repo.create(makeInput({ subject: "Réunion budget" }));
		const folded = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "reunion" },
			{ count: 50 },
		);
		assert.ok(
			folded.items.some((i) => i.subject === "Réunion budget"),
			"an unaccented needle matches an accented subject",
		);
	});

	test("a sub-3-character term falls back to the folded LIKE scan", async () => {
		await repo.create(makeInput({ subject: "Q2 results" }));
		const short = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "q2" },
			{ count: 50 },
		);
		assert.ok(
			short.items.some((i) => i.subject === "Q2 results"),
			"a two-character term still matches via LIKE",
		);
	});

	test("an updated subject is re-indexed by the FTS triggers", async () => {
		const created = await repo.create(makeInput({ subject: "draft proposal" }));
		await repo.update(ACCOUNT, created.threadMessageId, {
			subject: "final proposal",
		});
		const stale = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "draft" },
			{ count: 50 },
		);
		assert.ok(
			!stale.items.some((i) => i.threadMessageId === created.threadMessageId),
			"the old subject no longer matches after re-index",
		);
		const fresh = await repo.searchByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "final" },
			{ count: 50 },
		);
		assert.ok(
			fresh.items.some((i) => i.threadMessageId === created.threadMessageId),
			"the new subject matches after re-index",
		);
	});

	test("countByMailbox counts matches under the same predicate", async () => {
		const n = await repo.countByMailbox(
			ACCOUNT,
			MAILBOX,
			{ subject: "invoice" },
			{ limit: 100 },
		);
		assert.ok(n >= 1);
	});

	test("listByDate paginates with a stable keyset cursor", async () => {
		const acct = "acct-page";
		const base = Date.now();
		for (let i = 0; i < 5; i++) {
			await repo.create(
				makeInput({
					accountConfigId: acct,
					mailboxId: "mbx-page",
					subject: `page ${i}`,
					sentDate: base - i,
					internalDate: base - i,
				}),
			);
		}

		const first = await repo.listByDate(acct, { limit: 2, order: "desc" });
		assert.equal(first.items.length, 2);
		assert.ok(first.continuationToken);

		const second = await repo.listByDate(acct, {
			limit: 2,
			order: "desc",
			continuationToken: first.continuationToken,
		});
		assert.equal(second.items.length, 2);
		const firstIds = new Set(first.items.map((i) => i.threadMessageId));
		assert.ok(
			second.items.every((i) => !firstIds.has(i.threadMessageId)),
			"pages do not overlap",
		);
	});
	// #44: Flagged was a client-side filter over the newest page of the primary
	// inboxes, so a star outside that window was invisible. listByStarred is the
	// byStarred access pattern that view now reads.
	test("listByStarred returns starred rows from every mailbox", async () => {
		const acct = "acct-starred";
		const base = Date.now();
		await repo.create(
			makeInput({
				accountConfigId: acct,
				mailboxId: "mbx-inbox",
				subject: "starred in inbox",
				hasStars: true,
				sentDate: base,
				internalDate: base,
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: acct,
				mailboxId: "mbx-archive",
				subject: "starred in archive",
				hasStars: true,
				sentDate: base - 1,
				internalDate: base - 1,
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: acct,
				mailboxId: "mbx-inbox",
				subject: "not starred",
				hasStars: false,
				sentDate: base - 2,
				internalDate: base - 2,
			}),
		);

		const result = await repo.listByStarred(acct, { order: "desc" });
		assert.deepEqual(
			result.items.map((i) => i.subject),
			["starred in inbox", "starred in archive"],
		);
	});

	// The star colour is presentation only and defaults to the `none` sentinel,
	// so a row starred without an explicit colour must still be returned.
	test("listByStarred returns a starred row whose colour is the none sentinel", async () => {
		const acct = "acct-starred-none";
		const created = await repo.create(
			makeInput({
				accountConfigId: acct,
				subject: "uncoloured star",
				hasStars: true,
			}),
		);
		assert.equal(created.star, "none");

		const result = await repo.listByStarred(acct);
		assert.deepEqual(
			result.items.map((i) => i.subject),
			["uncoloured star"],
		);
	});

	test("listByStarred narrows to the supplied mailbox set", async () => {
		const acct = "acct-starred-scope";
		await repo.create(
			makeInput({
				accountConfigId: acct,
				mailboxId: "mbx-kept",
				subject: "kept",
				hasStars: true,
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: acct,
				mailboxId: "mbx-muted",
				subject: "muted",
				hasStars: true,
			}),
		);

		const result = await repo.listByStarred(acct, {
			mailboxIds: new Set(["mbx-kept"]),
		});
		assert.deepEqual(
			result.items.map((i) => i.subject),
			["kept"],
		);
	});

	test("listByStarred excludes soft-deleted rows when asked", async () => {
		const acct = "acct-starred-deleted";
		await repo.create(
			makeInput({
				accountConfigId: acct,
				subject: "live star",
				hasStars: true,
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: acct,
				subject: "trashed star",
				hasStars: true,
				isDeleted: true,
			}),
		);

		const result = await repo.listByStarred(acct, { excludeDeleted: true });
		assert.deepEqual(
			result.items.map((i) => i.subject),
			["live star"],
		);
	});

	test("listByStarred pages without overlap", async () => {
		const acct = "acct-starred-page";
		const base = Date.now();
		for (let i = 0; i < 5; i++) {
			await repo.create(
				makeInput({
					accountConfigId: acct,
					subject: `star ${i}`,
					hasStars: true,
					sentDate: base - i,
					internalDate: base - i,
				}),
			);
		}

		const first = await repo.listByStarred(acct, { limit: 2, order: "desc" });
		assert.equal(first.items.length, 2);
		assert.ok(first.continuationToken);

		const second = await repo.listByStarred(acct, {
			limit: 2,
			order: "desc",
			continuationToken: first.continuationToken,
		});
		assert.equal(second.items.length, 2);
		const firstIds = new Set(first.items.map((i) => i.threadMessageId));
		assert.ok(
			second.items.every((i) => !firstIds.has(i.threadMessageId)),
			"pages do not overlap",
		);
	});
});
