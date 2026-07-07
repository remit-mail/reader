import assert from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import shortUuid from "short-uuid";
import { threadMessageTable } from "../schema/thread-message.js";
import {
	clampThreadSearchLimit,
	DrizzleThreadMessageRepository,
	THREAD_SEARCH_MAX_LIMIT,
} from "./thread-message.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const translator = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);
const uuid = () => translator.generate();

const PG_URL =
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_test";

// These suites connect to a real Postgres (pg_trgm/unaccent search DDL, which
// embedded-postgres cannot provide), so they run only in the dedicated pg job
// that provisions Postgres — mirroring the RUN_INTEG_TESTS gate used across the
// integration suites. The pure-unit describe below always runs.
const RUN_INTEG = process.env.RUN_INTEG_TESTS === "1";

const DDL = `
CREATE TABLE IF NOT EXISTS thread_message (
  thread_message_id TEXT PRIMARY KEY,
  account_config_id TEXT NOT NULL,
  thread_id         TEXT NOT NULL,
  message_id        TEXT NOT NULL,
  mailbox_id        TEXT NOT NULL,
  uid               INTEGER NOT NULL,
  message_id_header TEXT,
  in_reply_to       TEXT,
  reference_order   INTEGER NOT NULL DEFAULT 0,
  from_email        TEXT,
  from_name         TEXT,
  subject           TEXT,
  internal_date     BIGINT NOT NULL,
  sent_date         BIGINT NOT NULL,
  is_read           BOOLEAN NOT NULL,
  has_attachment    BOOLEAN NOT NULL,
  star              TEXT NOT NULL DEFAULT 'none',
  has_stars         BOOLEAN NOT NULL,
  is_deleted        BOOLEAN NOT NULL,
  snippet           TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tm_by_date_idx ON thread_message (account_config_id, sent_date);
CREATE INDEX IF NOT EXISTS tm_by_mailbox_idx ON thread_message (account_config_id, mailbox_id, sent_date);
CREATE INDEX IF NOT EXISTS tm_by_attachment_idx ON thread_message (account_config_id, has_attachment, sent_date);
CREATE INDEX IF NOT EXISTS tm_by_starred_idx ON thread_message (account_config_id, has_stars, sent_date);
CREATE INDEX IF NOT EXISTS tm_by_mailbox_readstatus_idx ON thread_message (account_config_id, mailbox_id, is_read, sent_date);
CREATE INDEX IF NOT EXISTS tm_by_thread_idx ON thread_message (thread_id, internal_date);
CREATE INDEX IF NOT EXISTS tm_by_message_idx ON thread_message (message_id);
`;

function makeInput(
	accountConfigId: string,
	mailboxId: string,
	overrides: Partial<CreateThreadMessageInput> = {},
): CreateThreadMessageInput {
	const now = Date.now();
	return {
		accountConfigId,
		threadId: uuid(),
		messageId: uuid(),
		mailboxId,
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

// The trigram search columns/indexes live in an idempotent SQL script applied
// after `drizzle-kit push` (kept out of the drizzle schema — see the script
// header). Apply it here too so the test table matches production.
const SEARCH_DDL = readFileSync(
	fileURLToPath(
		new URL("../../../../npm-scripts/pg-search-index.sql", import.meta.url),
	),
	"utf8",
);

async function setupDb(): Promise<void> {
	const db = drizzle(PG_URL, { schema: { threadMessage: threadMessageTable } });
	await db.execute(sql.raw(DDL));
	await db.execute(sql.raw(SEARCH_DDL));
	const client = (db as unknown as { $client: { end(): Promise<void> } })
		.$client;
	await client.end();
}

// ─── clampThreadSearchLimit unit tests ───────────────────────────────────────

describe("clampThreadSearchLimit", () => {
	test("defaults an absent limit to the cap", () => {
		assert.equal(clampThreadSearchLimit(undefined), THREAD_SEARCH_MAX_LIMIT);
	});

	test("caps a too-large limit at the max", () => {
		assert.equal(clampThreadSearchLimit(5000), THREAD_SEARCH_MAX_LIMIT);
	});

	test("passes a within-range limit through", () => {
		assert.equal(clampThreadSearchLimit(200), 200);
	});

	test("floors a non-positive limit at 1", () => {
		assert.equal(clampThreadSearchLimit(0), 1);
		assert.equal(clampThreadSearchLimit(-10), 1);
	});

	test("truncates and defaults non-finite input", () => {
		assert.equal(clampThreadSearchLimit(12.9), 12);
		assert.equal(clampThreadSearchLimit(Number.NaN), THREAD_SEARCH_MAX_LIMIT);
	});
});

// ─── searchByMailboxWindow / countByMailbox integration tests ─────────────────
//
// These six scenarios mirror the canonical DynamoDB test suite in
// packages/remit-electrodb-service/src/models/thread-message.test.ts.

describe(
	"DrizzleThreadMessageRepository.searchByMailboxWindow / countByMailbox",
	{ skip: !RUN_INTEG },
	() => {
		let repo: DrizzleThreadMessageRepository;
		const cleanup: Array<() => Promise<void>> = [];

		before(async () => {
			await setupDb();
			repo = new DrizzleThreadMessageRepository(PG_URL);
		});

		after(async () => {
			for (const fn of cleanup.reverse()) {
				await fn();
			}
			await repo.close();
		});

		async function seed(
			accountConfigId: string,
			mailboxId: string,
			rows: Array<Partial<CreateThreadMessageInput>>,
		): Promise<void> {
			for (const overrides of rows) {
				const created = await repo.create(
					makeInput(accountConfigId, mailboxId, overrides),
				);
				cleanup.push(() =>
					repo.delete(accountConfigId, created.threadMessageId),
				);
			}
		}

		// ── Scenario 1 ────────────────────────────────────────────────────────────
		// The unread boolean narrows results to matching rows only.
		test("unread filter returns only matching rows", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ isRead: false, subject: "unread one" },
				{ isRead: false, subject: "unread two" },
				{ isRead: true, subject: "read one" },
			]);

			const unread = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ unread: true },
				{ excludeDeleted: true },
			);
			assert.equal(unread.items.length, 2);
			assert.ok(unread.items.every((r) => r.isRead === false));

			const read = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ unread: false },
				{ excludeDeleted: true },
			);
			assert.equal(read.items.length, 1);
			assert.equal(read.items[0].subject, "read one");
		});

		// ── Scenario 2 ────────────────────────────────────────────────────────────
		// subject filter matches a substring of the subject.
		test("subject filter matches a substring", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ subject: "invoice March" },
				{ subject: "invoice April" },
				{ subject: "newsletter" },
			]);

			const result = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ subject: "invoice" },
				{ excludeDeleted: true },
			);
			assert.equal(result.items.length, 2);
			assert.ok(
				result.items.every((r) => r.subject?.includes("invoice") ?? false),
			);
		});

		// ── Scenario 3 ────────────────────────────────────────────────────────────
		// A full page (limit 2 over 5 rows) yields a cursor to resume from.
		test("a full page yields a continuation cursor", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			await seed(
				acct,
				mbx,
				Array.from({ length: 5 }, (_, i) => ({
					subject: `row ${i}`,
					sentDate: now - i,
					internalDate: now - i,
				})),
			);

			const result = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{},
				{ excludeDeleted: true, limit: 2 },
			);
			assert.equal(result.items.length, 2);
			assert.ok(result.continuationToken, "full page must yield a cursor");
		});

		// ── Scenario 4 ────────────────────────────────────────────────────────────
		// Matching runs over the WHOLE mailbox via the trigram index, so an old
		// match well behind the recent rows is still found and paged (the DynamoDB
		// recent-window bound does not apply on Postgres — the improvement over #443
		// on the DDB path).
		test("an old match behind the recent rows is still found — matching is whole-mailbox, not window-bounded", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			// The newest 2 rows do NOT match; the older 4 rows DO — searching "match"
			// (lowercased, as the client sends it) must reach all four.
			const rows = [
				{ subject: "recent plain a", sentDate: now, internalDate: now },
				{ subject: "recent plain b", sentDate: now - 1, internalDate: now - 1 },
				{ subject: "old MATCH c", sentDate: now - 2, internalDate: now - 2 },
				{ subject: "old MATCH d", sentDate: now - 3, internalDate: now - 3 },
				{ subject: "old MATCH e", sentDate: now - 4, internalDate: now - 4 },
				{ subject: "old MATCH f", sentDate: now - 5, internalDate: now - 5 },
			];
			await seed(acct, mbx, rows);

			const page1 = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ subject: "match" },
				{ excludeDeleted: true, limit: 2 },
			);
			assert.deepEqual(
				page1.items.map((r) => r.subject),
				["old MATCH c", "old MATCH d"],
				"first page holds the two newest matches, not the recent non-matches",
			);
			assert.ok(
				page1.continuationToken,
				"more matches remain — cursor expected",
			);

			const page2 = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ subject: "match" },
				{
					excludeDeleted: true,
					limit: 2,
					continuationToken: page1.continuationToken,
				},
			);
			assert.deepEqual(
				page2.items.map((r) => r.subject),
				["old MATCH e", "old MATCH f"],
				"paging reaches the oldest matches",
			);

			const count = await repo.countByMailbox(
				acct,
				mbx,
				{ subject: "match" },
				{ excludeDeleted: true, limit: 2 },
			);
			assert.equal(
				count,
				2,
				"count is capped at the page limit when more match",
			);
		});

		// ── Scenario 5 ────────────────────────────────────────────────────────────
		// desc default: the first page holds the newest matches; count equals the
		// page length when more rows match than the limit.
		test("desc page holds the newest matches and count equals items.length", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			await seed(
				acct,
				mbx,
				Array.from({ length: 5 }, (_, i) => ({
					subject: `alpha ${i}`,
					sentDate: now - i,
					internalDate: now - i,
				})),
			);

			const window = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ subject: "alpha" },
				{ excludeDeleted: true, limit: 2 },
			);
			assert.equal(window.items.length, 2);
			const dates = window.items.map((r) => r.sentDate).sort((a, b) => b - a);
			assert.deepEqual(dates, [now, now - 1], "page holds the two newest rows");

			const count = await repo.countByMailbox(
				acct,
				mbx,
				{ subject: "alpha" },
				{ excludeDeleted: true, limit: 2 },
			);
			assert.equal(count, window.items.length, "count == items.length");
			assert.equal(count, 2);
		});

		// ── Scenario 6 ────────────────────────────────────────────────────────────
		// order:asc returns the OLDEST matches first; count agrees with the page.
		test("order:asc returns the oldest matches first", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			await seed(
				acct,
				mbx,
				Array.from({ length: 5 }, (_, i) => ({
					subject: `beta ${i}`,
					sentDate: now - i,
					internalDate: now - i,
				})),
			);

			const window = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ subject: "beta" },
				{ excludeDeleted: true, limit: 2, order: "asc" },
			);
			assert.equal(window.items.length, 2);
			const dates = window.items.map((r) => r.sentDate).sort((a, b) => a - b);
			assert.deepEqual(
				dates,
				[now - 4, now - 3],
				"asc page holds the two oldest rows",
			);

			const count = await repo.countByMailbox(
				acct,
				mbx,
				{ subject: "beta" },
				{ excludeDeleted: true, limit: 2, order: "asc" },
			);
			assert.equal(count, window.items.length, "count == items.length for asc");
			assert.equal(count, 2);
		});
	},
);

// ─── Native text-search semantics ─────────────────────────────────────────────
// The type-ahead search box lowercases the query before sending it. These tests
// pin the Postgres-native behaviour: case- and accent-insensitive substring
// matching over the whole mailbox, scoped to the account/mailbox.

describe(
	"DrizzleThreadMessageRepository — native text search",
	{ skip: !RUN_INTEG },
	() => {
		let repo: DrizzleThreadMessageRepository;
		const cleanup: Array<() => Promise<void>> = [];

		before(async () => {
			await setupDb();
			repo = new DrizzleThreadMessageRepository(PG_URL);
		});

		after(async () => {
			for (const fn of cleanup.reverse()) {
				await fn();
			}
			await repo.close();
		});

		async function seed(
			accountConfigId: string,
			mailboxId: string,
			rows: Array<Partial<CreateThreadMessageInput>>,
		): Promise<void> {
			for (const overrides of rows) {
				const created = await repo.create(
					makeInput(accountConfigId, mailboxId, overrides),
				);
				cleanup.push(() =>
					repo.delete(accountConfigId, created.threadMessageId),
				);
			}
		}

		const subjectsOf = (r: { items: Array<{ subject?: string }> }) =>
			r.items.map((i) => i.subject).sort();

		test("subject match is case-insensitive (client lowercases the query)", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ subject: "Quarterly Invoice" },
				{ subject: "invoice reminder" },
				{ subject: "Newsletter" },
			]);

			const res = await repo.searchByMailboxWindow(acct, mbx, {
				query: "invoice",
			});
			assert.deepEqual(subjectsOf(res), [
				"Quarterly Invoice",
				"invoice reminder",
			]);
		});

		test("sender name match is case-insensitive and accent-insensitive", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ fromName: "Angélique Müller", subject: "a" },
				{ fromName: "Someone Else", subject: "b" },
			]);

			const accented = await repo.searchByMailboxWindow(acct, mbx, {
				query: "angelique",
			});
			assert.deepEqual(
				subjectsOf(accented),
				["a"],
				"accent-folded name matches",
			);

			const upper = await repo.searchByMailboxWindow(acct, mbx, {
				query: "muller",
			});
			assert.deepEqual(subjectsOf(upper), ["a"], "case-folded name matches");
		});

		test("from filter matches the email address as well as the display name", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ fromName: "Jane Doe", fromEmail: "jane@acme.example", subject: "a" },
				{ fromName: "Bob", fromEmail: "bob@other.example", subject: "b" },
			]);

			const byDomain = await repo.searchByMailboxWindow(acct, mbx, {
				from: "acme",
			});
			assert.deepEqual(subjectsOf(byDomain), ["a"], "matches the email domain");
		});

		test("multi-word query ANDs tokens across the subject and from fields", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ fromName: "Emma Stone", subject: "Sleep schedule" },
				{ fromName: "Emma Watson", subject: "Travel plans" },
				{ subject: "Emma Sleep mattress order" },
			]);

			// "emma sleep": each token must appear in subject OR from — row 1 (Emma in
			// from, Sleep in subject) and row 3 (both in subject) match; row 2 does not.
			const res = await repo.searchByMailboxWindow(acct, mbx, {
				query: "emma sleep",
			});
			assert.deepEqual(subjectsOf(res), [
				"Emma Sleep mattress order",
				"Sleep schedule",
			]);
		});

		test("subject filter does not match text that only appears in the from fields", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ fromName: "Marketing", subject: "Weekly digest" },
				{ subject: "Marketing update" },
			]);

			const res = await repo.searchByMailboxWindow(acct, mbx, {
				subject: "marketing",
			});
			assert.deepEqual(subjectsOf(res), ["Marketing update"]);
		});

		test("results stay scoped to the account and mailbox", async () => {
			const acctA = uuid();
			const acctB = uuid();
			const mbx1 = uuid();
			const mbx2 = uuid();
			await seed(acctA, mbx1, [{ subject: "shared token here" }]);
			await seed(acctB, mbx1, [{ subject: "shared token elsewhere" }]);
			await seed(acctA, mbx2, [{ subject: "shared token other mailbox" }]);

			const res = await repo.searchByMailboxWindow(acctA, mbx1, {
				query: "shared",
			});
			assert.deepEqual(subjectsOf(res), ["shared token here"]);
		});

		test("LIKE metacharacters in the query match literally", async () => {
			const acct = uuid();
			const mbx = uuid();
			await seed(acct, mbx, [
				{ subject: "50% off today" },
				{ subject: "50 percent off" },
			]);

			const res = await repo.searchByMailboxWindow(acct, mbx, { query: "50%" });
			assert.deepEqual(subjectsOf(res), ["50% off today"]);
		});

		test("whole-mailbox recall: a match far behind the recent rows is found", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			const rows = Array.from({ length: 40 }, (_, i) => ({
				subject: i === 0 ? "needle in the haystack" : `filler ${i}`,
				sentDate: now - i,
				internalDate: now - i,
			}));
			// Put the only match at the OLDEST position.
			rows[0].subject = "filler 0";
			rows[39].subject = "needle in the haystack";
			await seed(acct, mbx, rows);

			const res = await repo.searchByMailboxWindow(
				acct,
				mbx,
				{ query: "needle" },
				{ limit: 5 },
			);
			assert.deepEqual(subjectsOf(res), ["needle in the haystack"]);
		});
	},
);

// ─── Smoke tests for the full interface ──────────────────────────────────────

describe(
	"DrizzleThreadMessageRepository — core CRUD",
	{ skip: !RUN_INTEG },
	() => {
		let repo: DrizzleThreadMessageRepository;
		const cleanup: Array<() => Promise<void>> = [];

		before(async () => {
			await setupDb();
			repo = new DrizzleThreadMessageRepository(PG_URL);
		});

		after(async () => {
			for (const fn of cleanup.reverse()) {
				await fn();
			}
			await repo.close();
		});

		test("create and get round-trip", async () => {
			const acct = uuid();
			const mbx = uuid();
			const created = await repo.create(
				makeInput(acct, mbx, { subject: "hello" }),
			);
			cleanup.push(() => repo.delete(acct, created.threadMessageId));
			assert.ok(created.threadMessageId);
			assert.equal(created.subject, "hello");

			const fetched = await repo.get(acct, created.threadMessageId);
			assert.equal(fetched.threadMessageId, created.threadMessageId);
		});

		test("update persists", async () => {
			const acct = uuid();
			const mbx = uuid();
			const created = await repo.create(
				makeInput(acct, mbx, { subject: "original" }),
			);
			cleanup.push(() => repo.delete(acct, created.threadMessageId));

			const updated = await repo.update(acct, created.threadMessageId, {
				subject: "updated",
			});
			assert.equal(updated.subject, "updated");
		});

		test("delete removes the row", async () => {
			const acct = uuid();
			const mbx = uuid();
			const created = await repo.create(makeInput(acct, mbx));
			await repo.delete(acct, created.threadMessageId);
			await assert.rejects(
				() => repo.get(acct, created.threadMessageId),
				/not found/i,
			);
		});

		test("listByMailbox returns desc-ordered rows for the mailbox", async () => {
			const acct = uuid();
			const mbx = uuid();
			const now = Date.now();
			const a = await repo.create(
				makeInput(acct, mbx, {
					sentDate: now - 1000,
					internalDate: now - 1000,
					subject: "older",
				}),
			);
			cleanup.push(() => repo.delete(acct, a.threadMessageId));
			const b = await repo.create(
				makeInput(acct, mbx, {
					sentDate: now,
					internalDate: now,
					subject: "newer",
				}),
			);
			cleanup.push(() => repo.delete(acct, b.threadMessageId));

			const result = await repo.listByMailbox(acct, mbx);
			assert.equal(result.items.length, 2);
			assert.equal(result.items[0].subject, "newer");
			assert.equal(result.items[1].subject, "older");
		});

		test("get with array returns all matched rows", async () => {
			const acct = uuid();
			const mbx = uuid();
			const a = await repo.create(makeInput(acct, mbx));
			cleanup.push(() => repo.delete(acct, a.threadMessageId));
			const b = await repo.create(makeInput(acct, mbx));
			cleanup.push(() => repo.delete(acct, b.threadMessageId));

			const rows = await repo.get(acct, [a.threadMessageId, b.threadMessageId]);
			assert.equal(rows.length, 2);
		});

		// ── Tenant scoping on the id-only lookups (issue #1193) ────────────────────
		// findByMessageId / findAllByMessageId / getByMessageId / countByThread carry
		// accountConfigId in the WHERE clause, so a row created under account A must
		// never resolve under account B's scope.

		test("findByMessageId is scoped to accountConfigId", async () => {
			const acct = uuid();
			const other = uuid();
			const mbx = uuid();
			const messageId = uuid();
			const created = await repo.create(makeInput(acct, mbx, { messageId }));
			cleanup.push(() => repo.delete(acct, created.threadMessageId));

			const own = await repo.findByMessageId(acct, messageId);
			assert.ok(own);
			assert.equal(own.threadMessageId, created.threadMessageId);

			const foreign = await repo.findByMessageId(other, messageId);
			assert.equal(foreign, null);
		});

		test("findAllByMessageId is scoped to accountConfigId", async () => {
			const acct = uuid();
			const other = uuid();
			const messageId = uuid();
			// Same messageId across two mailboxes of the same account.
			const a = await repo.create(makeInput(acct, uuid(), { messageId }));
			cleanup.push(() => repo.delete(acct, a.threadMessageId));
			const b = await repo.create(makeInput(acct, uuid(), { messageId }));
			cleanup.push(() => repo.delete(acct, b.threadMessageId));

			const own = await repo.findAllByMessageId(acct, messageId);
			assert.equal(own.length, 2);

			const foreign = await repo.findAllByMessageId(other, messageId);
			assert.equal(foreign.length, 0);
		});

		test("getByMessageId throws for another account's messageId", async () => {
			const acct = uuid();
			const other = uuid();
			const mbx = uuid();
			const messageId = uuid();
			const created = await repo.create(makeInput(acct, mbx, { messageId }));
			cleanup.push(() => repo.delete(acct, created.threadMessageId));

			const own = await repo.getByMessageId(acct, messageId);
			assert.equal(own.threadMessageId, created.threadMessageId);

			await assert.rejects(() => repo.getByMessageId(other, messageId));
		});

		test("countByThread is scoped to accountConfigId", async () => {
			const acct = uuid();
			const other = uuid();
			const mbx = uuid();
			const threadId = uuid();
			for (let i = 0; i < 3; i++) {
				const row = await repo.create(makeInput(acct, mbx, { threadId }));
				cleanup.push(() => repo.delete(acct, row.threadMessageId));
			}

			assert.equal(await repo.countByThread(acct, threadId), 3);
			assert.equal(await repo.countByThread(other, threadId), 0);
		});
	},
);
