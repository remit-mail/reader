import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import {
	BASE_DATE,
	type Category,
	categoryFixtureRows,
	LIVE_TOTALS,
	totalRows,
} from "./category-fixture.js";
import {
	DrizzleThreadMessageRepository,
	THREAD_SEARCH_MAX_LIMIT,
} from "./thread-message.js";

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
	let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>["sqlite"];
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;

	before(async () => {
		({ db, sqlite, close } = await createSqliteTestDb(
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
		const n = await repo.countByMailbox(ACCOUNT, MAILBOX, {
			subject: "invoice",
		});
		assert.ok(n >= 1);
	});

	test("listByThread returns inbox and sent messages interleaved in order", async () => {
		const acct = "acct-conversation";
		const threadId = "t-conversation";
		const inbox = "mbx-inbox";
		const sent = "mbx-sent";
		const base = Date.now();
		const turns = [
			{ mailboxId: inbox, subject: "Databricks pricing", at: base },
			{ mailboxId: sent, subject: "Re: Databricks pricing", at: base + 1000 },
			{ mailboxId: inbox, subject: "Re: Databricks pricing", at: base + 2000 },
			{ mailboxId: sent, subject: "Re: Databricks pricing", at: base + 3000 },
		];
		for (const [index, turn] of turns.entries()) {
			await repo.create(
				makeInput({
					accountConfigId: acct,
					threadId,
					messageId: `m-conversation-${index}`,
					mailboxId: turn.mailboxId,
					subject: turn.subject,
					referenceOrder: index,
					internalDate: turn.at,
					sentDate: turn.at,
				}),
			);
		}

		const ascending = await repo.listByThread(threadId, acct, {
			order: "asc",
			excludeDeleted: true,
		});
		assert.deepEqual(
			ascending.items.map((item) => item.mailboxId),
			[inbox, sent, inbox, sent],
			"the conversation carries both received and sent messages, oldest first",
		);

		const descending = await repo.listByThread(threadId, acct, {
			order: "desc",
			excludeDeleted: true,
		});
		assert.deepEqual(
			descending.items.map((item) => item.mailboxId),
			[sent, inbox, sent, inbox],
			"reversing the order reverses the conversation",
		);
	});

	test("listByThread defaults to oldest first, by the date the mail was sent", async () => {
		const acct = "acct-conversation-dates";
		const threadId = "t-conversation-dates";
		const base = Date.now();
		// The folder a message was delivered to decides its internalDate, so a
		// reply synced from Sent can carry an earlier internalDate than the
		// message it answers. sentDate is what the conversation is ordered by.
		const turns = [
			{ messageId: "m-question", sentDate: base, internalDate: base + 5000 },
			{ messageId: "m-answer", sentDate: base + 1000, internalDate: base },
		];
		for (const turn of turns) {
			await repo.create(
				makeInput({
					accountConfigId: acct,
					threadId,
					messageId: turn.messageId,
					sentDate: turn.sentDate,
					internalDate: turn.internalDate,
				}),
			);
		}

		const result = await repo.listByThread(threadId, acct, {
			excludeDeleted: true,
		});
		assert.deepEqual(
			result.items.map((item) => item.messageId),
			["m-question", "m-answer"],
			"the reply follows the message it answers",
		);
	});

	test("listByThread paginates in sentDate order without skipping or repeating", async () => {
		const acct = "acct-conversation-pages";
		const threadId = "t-conversation-pages";
		const base = Date.now();
		for (let index = 0; index < 5; index++) {
			await repo.create(
				makeInput({
					accountConfigId: acct,
					threadId,
					messageId: `m-page-${index}`,
					sentDate: base + index * 1000,
					internalDate: base,
				}),
			);
		}

		const seen: string[] = [];
		let continuationToken: string | undefined;
		do {
			const page = await repo.listByThread(threadId, acct, {
				limit: 2,
				continuationToken,
				excludeDeleted: true,
			});
			seen.push(...page.items.map((item) => item.messageId));
			continuationToken = page.continuationToken;
		} while (continuationToken);

		assert.deepEqual(seen, [
			"m-page-0",
			"m-page-1",
			"m-page-2",
			"m-page-3",
			"m-page-4",
		]);
	});

	test("listByThread excludes soft-deleted messages but keeps the rest of the conversation", async () => {
		const acct = "acct-conversation-deleted";
		const threadId = "t-conversation-deleted";
		const base = Date.now();
		const kept = await repo.create(
			makeInput({
				accountConfigId: acct,
				threadId,
				messageId: "m-kept",
				mailboxId: "mbx-sent",
				internalDate: base,
				sentDate: base,
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: acct,
				threadId,
				messageId: "m-trashed",
				mailboxId: "mbx-trash",
				isDeleted: true,
				internalDate: base + 1000,
				sentDate: base + 1000,
			}),
		);

		const result = await repo.listByThread(threadId, acct, {
			excludeDeleted: true,
		});
		assert.deepEqual(
			result.items.map((item) => item.threadMessageId),
			[kept.threadMessageId],
		);
	});

	test("listByThread scopes to the account config", async () => {
		const threadId = "t-shared-id";
		await repo.create(
			makeInput({
				accountConfigId: "acct-mine",
				threadId,
				messageId: "m-mine",
			}),
		);
		await repo.create(
			makeInput({
				accountConfigId: "acct-theirs",
				threadId,
				messageId: "m-theirs",
			}),
		);

		const mine = await repo.listByThread(threadId, "acct-mine");
		assert.deepEqual(
			mine.items.map((item) => item.messageId),
			["m-mine"],
		);
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

	describe("search continuation token", () => {
		const acct = "acct-search-cursor";

		before(async () => {
			const base = Date.now();
			for (let i = 0; i < 4; i++) {
				await repo.create(
					makeInput({
						accountConfigId: acct,
						subject: `cursor probe ${i}`,
						sentDate: base - i,
						internalDate: base - i,
					}),
				);
			}
		});

		test("an absent token returns the first page", async () => {
			const page = await repo.searchByMailboxWindow(
				acct,
				MAILBOX,
				{ subject: "cursor probe" },
				{ limit: 2, order: "desc" },
			);
			assert.equal(page.items.length, 2);
			assert.equal(page.items[0]?.subject, "cursor probe 0");
			assert.ok(page.continuationToken);
		});

		test("a server-minted token returns the next page", async () => {
			const first = await repo.searchByMailboxWindow(
				acct,
				MAILBOX,
				{ subject: "cursor probe" },
				{ limit: 2, order: "desc" },
			);
			const second = await repo.searchByMailboxWindow(
				acct,
				MAILBOX,
				{ subject: "cursor probe" },
				{
					limit: 2,
					order: "desc",
					continuationToken: first.continuationToken,
				},
			);
			assert.equal(second.items.length, 2);
			const firstIds = new Set(first.items.map((i) => i.threadMessageId));
			assert.ok(
				second.items.every((i) => !firstIds.has(i.threadMessageId)),
				"pages do not overlap",
			);
		});

		for (const [label, token] of [
			["an unparseable", "not-a-cursor"],
			["a non-object", Buffer.from("123").toString("base64")],
			["an incomplete", Buffer.from('{"s":1}').toString("base64")],
		] as const) {
			test(`${label} token is a validation failure`, async () => {
				await assert.rejects(
					() =>
						repo.searchByMailboxWindow(
							acct,
							MAILBOX,
							{ subject: "cursor probe" },
							{ limit: 2, continuationToken: token },
						),
					(error: unknown) => {
						assert.equal((error as { statusCode?: number }).statusCode, 400);
						assert.equal((error as Error).name, "BadRequestError");
						return true;
					},
				);
			});
		}

		test("an undecodable account cursor is a validation failure", async () => {
			await assert.rejects(
				() => repo.listByAccount(acct, { continuationToken: "not-a-cursor" }),
				(error: unknown) => {
					assert.equal((error as { statusCode?: number }).statusCode, 400);
					return true;
				},
			);
		});
	});

	// ─── category as a SQL predicate (#304) ───────────────────────────────────
	//
	// The shape is the owner's instance, not a convenience fixture — see
	// ./category-fixture.ts. A filter applied to the page the server happens to
	// return is empty or near-empty on that shape whatever the page size, which
	// is the reported bug.
	describe("category filter over the whole mailbox", () => {
		const CAT_ACCOUNT = "acct-category";
		const CAT_MAILBOX = "mbx-category";

		before(async () => {
			const rows = categoryFixtureRows({
				totals: LIVE_TOTALS,
				accountConfigId: CAT_ACCOUNT,
				mailboxId: CAT_MAILBOX,
			});
			assert.equal(rows.length, totalRows(LIVE_TOTALS));
			for (let i = 0; i < rows.length; i += 500) {
				await db.insert(threadMessageTable).values(rows.slice(i, i + 500));
			}
		});

		const walk = async (
			category: Category[],
			pageSize: number,
		): Promise<string[]> => {
			const seen: string[] = [];
			let continuationToken: string | undefined;
			do {
				const page = await repo.searchByMailboxWindow(
					CAT_ACCOUNT,
					CAT_MAILBOX,
					{ category },
					{
						limit: pageSize,
						order: "desc",
						excludeDeleted: true,
						continuationToken,
					},
				);
				seen.push(...page.items.map((item) => item.threadMessageId));
				continuationToken = page.continuationToken;
			} while (continuationToken);
			return seen;
		};

		test("the newest page holds almost none of the rare categories", async () => {
			const newest = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{},
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(newest.items.length, 50);
			const count = (category: Category) =>
				newest.items.filter((item) => item.category === category).length;
			assert.ok(
				count("social") <= 2,
				"at most 2 social rows in the newest page",
			);
			assert.ok(
				count("personal") <= 2,
				"at most 2 personal rows in the newest page",
			);
		});

		// The regression the epic turns on. A filter resolved over the returned
		// page cannot produce this answer: on this mailbox the newest 50 rows hold
		// two personal messages, so the old path returned two rows (or none, for
		// social) with a continuation token attached.
		test("a filtered page is a full page of matches, however far back they sit", async () => {
			const personal = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["personal"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(personal.items.length, 50);
			assert.ok(
				personal.items.every((item) => item.category === "personal"),
				"every row on the page matches the filter",
			);

			const social = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["social"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(social.items.length, 50);
			assert.ok(social.items.every((item) => item.category === "social"));
		});

		test("the filtered page keeps newest-first order and the id tiebreak", async () => {
			const page = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["social"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			for (let i = 1; i < page.items.length; i++) {
				const previous = page.items[i - 1];
				const current = page.items[i];
				assert.ok(
					previous.sentDate > current.sentDate ||
						(previous.sentDate === current.sentDate &&
							previous.threadMessageId < current.threadMessageId),
					"rows descend by sentDate, ascending by id inside a tie group",
				);
			}
		});

		test("a continuation token walks the whole match set without repeats or gaps", async () => {
			const seen = await walk(["social"], 25);
			assert.equal(seen.length, LIVE_TOTALS.social);
			assert.equal(new Set(seen).size, LIVE_TOTALS.social);
		});

		test("multiple categories behave as a union", async () => {
			const page = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["social", "transactional"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(page.items.length, 50);
			assert.ok(
				page.items.every(
					(item) =>
						item.category === "social" || item.category === "transactional",
				),
			);

			const seen = await walk(["social", "transactional"], 200);
			assert.equal(seen.length, LIVE_TOTALS.social + LIVE_TOTALS.transactional);
		});

		test("countByMailbox counts the matches in the mailbox, not the page", async () => {
			assert.equal(
				await repo.countByMailbox(
					CAT_ACCOUNT,
					CAT_MAILBOX,
					{ category: ["social"] },
					{ excludeDeleted: true },
				),
				LIVE_TOTALS.social,
			);
		});

		// Regression for #509. The count was computed in full and then discarded
		// down to THREAD_SEARCH_MAX_LIMIT, so this mailbox's 4,753 personal
		// messages reported as 500 — a number that reads to the user as the whole
		// match. A page size bounds the rows a response carries; it cannot bound
		// how many messages match.
		test("a match far larger than a page reports its real size", async () => {
			assert.ok(
				LIVE_TOTALS.personal > THREAD_SEARCH_MAX_LIMIT,
				"the fixture has to outgrow the page cap for this to mean anything",
			);
			const page = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["personal"] },
				{ order: "desc", excludeDeleted: true },
			);
			assert.equal(page.items.length, THREAD_SEARCH_MAX_LIMIT);
			assert.equal(
				await repo.countByMailbox(
					CAT_ACCOUNT,
					CAT_MAILBOX,
					{ category: ["personal"] },
					{ excludeDeleted: true },
				),
				LIVE_TOTALS.personal,
			);
		});

		test("the category predicate composes with the other filters", async () => {
			const page = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["social"], unread: true },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(page.items.length, 50);
			assert.ok(
				page.items.every(
					(item) => item.category === "social" && item.isRead === false,
				),
			);

			const none = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: ["social"], starred: true },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(none.items.length, 0);
		});

		test("an empty category set is not a filter", async () => {
			const page = await repo.searchByMailboxWindow(
				CAT_ACCOUNT,
				CAT_MAILBOX,
				{ category: [] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.equal(page.items.length, 50);
			assert.ok(
				page.items.some((item) => item.category !== page.items[0]?.category),
				"the page is unfiltered, so it holds more than one category",
			);
		});

		// #45: `uncategorized` is the not-yet-classified state as a named value.
		// Folding it into `personal` made a classification gap read as a large
		// personal inbox, so the filter has to be able to ask for it and must
		// never answer with the other.
		test("uncategorized is its own filterable value", async () => {
			const account = "acct-category-default";
			const mailbox = "mbx-category-default";
			const base = BASE_DATE;
			await repo.create(
				makeInput({
					accountConfigId: account,
					mailboxId: mailbox,
					messageId: "m-default",
					subject: "not yet classified",
					sentDate: base,
					internalDate: base,
				}),
			);
			await repo.create(
				makeInput({
					accountConfigId: account,
					mailboxId: mailbox,
					messageId: "m-personal",
					subject: "classified personal",
					category: "personal",
					sentDate: base - 1000,
					internalDate: base - 1000,
				}),
			);

			const uncategorized = await repo.searchByMailboxWindow(
				account,
				mailbox,
				{ category: ["uncategorized"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.deepEqual(
				uncategorized.items.map((item) => item.subject),
				["not yet classified"],
			);

			const personal = await repo.searchByMailboxWindow(
				account,
				mailbox,
				{ category: ["personal"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.deepEqual(
				personal.items.map((item) => item.subject),
				["classified personal"],
			);
		});

		test("soft-deleted rows stay out of a filtered page", async () => {
			const account = "acct-category-deleted";
			const mailbox = "mbx-category-deleted";
			await repo.create(
				makeInput({
					accountConfigId: account,
					mailboxId: mailbox,
					messageId: "m-live-social",
					subject: "live",
					category: "social",
				}),
			);
			await repo.create(
				makeInput({
					accountConfigId: account,
					mailboxId: mailbox,
					messageId: "m-trashed-social",
					subject: "trashed",
					category: "social",
					isDeleted: true,
				}),
			);

			const page = await repo.searchByMailboxWindow(
				account,
				mailbox,
				{ category: ["social"] },
				{ limit: 50, order: "desc", excludeDeleted: true },
			);
			assert.deepEqual(
				page.items.map((item) => item.subject),
				["live"],
			);
		});

		// The guard on I1. Without it a rare-category page silently costs a
		// mailbox scan and no test notices: the index is invisible to
		// vps-migrations-drift.sqlite.test.ts, which compares the committed
		// migration set against the same generated schema the index comes from.
		//
		// The statements are the ones the repo itself issued, captured from the
		// driver, so this cannot pass against a query the repo does not run. Each
		// assertion names the category column as well as the index: SQLite picks
		// this index on its (account_config_id, mailbox_id) prefix alone, so an
		// index-only assertion would still pass with the predicate removed.
		describe("query plan", () => {
			const selectsDuring = async (
				run: () => Promise<unknown>,
			): Promise<string[]> => {
				const captured: string[] = [];
				const original = sqlite.prepare.bind(sqlite);
				const record = (source: string) => {
					captured.push(source);
					return original(source);
				};
				sqlite.prepare = record as typeof sqlite.prepare;
				try {
					await run();
				} finally {
					sqlite.prepare = original as typeof sqlite.prepare;
				}
				return captured.filter((source) => /^\s*select/i.test(source));
			};

			const plansFor = (statements: string[]): string[] => {
				assert.ok(statements.length > 0, "the repo issued a select");
				return statements.flatMap((source) => {
					const parameters = new Array((source.match(/\?/g) ?? []).length).fill(
						0,
					);
					const rows = sqlite
						.prepare(`EXPLAIN QUERY PLAN ${source}`)
						.all(...parameters) as Array<{ detail: string }>;
					return rows.map((row) => row.detail);
				});
			};

			const assertServedByIndex = (plan: string[]): void => {
				assert.ok(
					plan.some(
						(detail) =>
							detail.includes("tm_by_mailbox_category_date") &&
							detail.includes("category=?"),
					),
					`no plan step matched on category through the index: ${plan.join(" | ")}`,
				);
			};

			test("the filtered window is served by tm_by_mailbox_category_date", async () => {
				const statements = await selectsDuring(() =>
					repo.searchByMailboxWindow(
						CAT_ACCOUNT,
						CAT_MAILBOX,
						{ category: ["social"] },
						{ limit: 50, order: "desc", excludeDeleted: true },
					),
				);
				assertServedByIndex(plansFor(statements));
			});

			test("the filtered count is served by tm_by_mailbox_category_date", async () => {
				const statements = await selectsDuring(() =>
					repo.countByMailbox(
						CAT_ACCOUNT,
						CAT_MAILBOX,
						{ category: ["social"] },
						{ excludeDeleted: true },
					),
				);
				assertServedByIndex(plansFor(statements));
			});
		});
	});
});
