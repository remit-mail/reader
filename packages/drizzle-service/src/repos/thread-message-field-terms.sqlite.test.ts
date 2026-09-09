import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import {
	DrizzleThreadMessageRepository,
	THREAD_SEARCH_MAX_LIMIT,
} from "./thread-message.js";

// `listByFieldTerms` on sqlite (#459): the terms decide inside the query, so a
// rule for a sender that has been quiet for months reaches its mail however
// much newer mail sits above it. Filtering a date-ordered page instead answers
// "matches among the newest N", which is the defect this pins.

const ACCOUNT = "acct-terms";
const OTHER_ACCOUNT = "acct-terms-other";
const MAILBOX = "mbx-terms";
const ARCHIVE = "mbx-terms-archive";

// One more than the ceiling a back-apply reads with, so the single old match
// sits strictly below any window the newest page could cover.
const NEWER_NOISE = THREAD_SEARCH_MAX_LIMIT + 1;

const OLD_DATE = 1_600_000_000_000;

function makeInput(
	overrides: Partial<CreateThreadMessageInput> = {},
): CreateThreadMessageInput {
	return {
		accountConfigId: ACCOUNT,
		threadId: `t-${Math.random().toString(36).slice(2)}`,
		messageId: `m-${Math.random().toString(36).slice(2)}`,
		mailboxId: MAILBOX,
		uid: 1,
		referenceOrder: 0,
		internalDate: OLD_DATE,
		sentDate: OLD_DATE,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		...overrides,
	};
}

describe("DrizzleThreadMessageRepository.listByFieldTerms (sqlite, #459)", () => {
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;

	before(async () => {
		const created = await createSqliteTestDb(
			{ threadMessage: threadMessageTable },
			{ searchIndex: true },
		);
		close = created.close;
		repo = new DrizzleThreadMessageRepository(created.db);

		await repo.create(
			makeInput({
				messageId: "quiet-sender",
				subject: "Your March statement",
				fromName: "Statements",
				fromEmail: "noreply@bank.example",
				listId: "statements.bank.example",
			}),
		);
		await repo.create(
			makeInput({
				messageId: "accented",
				subject: "CAFÉ closing early",
				fromName: "Café",
				fromEmail: "hello@paris.example",
				sentDate: OLD_DATE + 9_000_000,
				internalDate: OLD_DATE + 9_000_000,
			}),
		);
		for (let index = 0; index < NEWER_NOISE; index++) {
			await repo.create(
				makeInput({
					messageId: `noise-${index}`,
					subject: `Daily digest ${index}`,
					fromName: "Digest",
					fromEmail: "digest@other.example",
					sentDate: OLD_DATE + 1 + index,
					internalDate: OLD_DATE + 1 + index,
				}),
			);
		}
	});

	after(async () => {
		await close();
	});

	test("finds a match older than a whole page of newer non-matching mail", async () => {
		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "sender", contains: "bank.example" }],
			{ limit: THREAD_SEARCH_MAX_LIMIT },
		);

		assert.deepEqual(
			result.items.map((item) => item.messageId),
			["quiet-sender"],
		);
		assert.equal(result.continuationToken, undefined);
	});

	test("a page is a page of matches, not a page of rows", async () => {
		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "sender", contains: "bank.example" }],
			{ limit: 5 },
		);

		assert.equal(result.items.length, 1);
	});

	test("matches the subject and the List-Id columns", async () => {
		const bySubject = await repo.listByFieldTerms(ACCOUNT, [
			{ field: "subject", contains: "march statement" },
		]);
		const byListId = await repo.listByFieldTerms(ACCOUNT, [
			{ field: "listId", contains: "statements.bank.example" },
		]);

		assert.deepEqual(
			bySubject.items.map((item) => item.messageId),
			["quiet-sender"],
		);
		assert.deepEqual(
			byListId.items.map((item) => item.messageId),
			["quiet-sender"],
		);
	});

	test("`and` requires every term, `or` any of them", async () => {
		const terms = [
			{ field: "sender", contains: "bank.example" },
			{ field: "subject", contains: "daily digest 0" },
		] as const;

		const conjunction = await repo.listByFieldTerms(ACCOUNT, terms, {
			operator: "and",
		});
		const disjunction = await repo.listByFieldTerms(ACCOUNT, terms, {
			operator: "or",
		});

		assert.deepEqual(conjunction.items, []);
		assert.deepEqual(disjunction.items.map((item) => item.messageId).sort(), [
			"noise-0",
			"quiet-sender",
		]);
	});

	// Below the trigram floor the predicate is the folded LIKE, and sqlite's
	// lower() folds ASCII only — `é` never matches a stored `CAFÉ`. Applying it
	// anyway would drop a row the caller's own matcher accepts, which is #459
	// again for that clause shape, so a short non-ASCII term narrows nothing.
	test("drops a short accented term rather than missing the row it should match", async () => {
		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "subject", contains: "é" }],
			{ limit: THREAD_SEARCH_MAX_LIMIT },
		);

		assert.ok(
			result.items.some((item) => item.messageId === "accented"),
			"the accented row survives",
		);
		assert.ok(result.items.length > 1, "the term narrowed nothing at all");
	});

	test("keeps narrowing on the other terms of an `and` around a dropped one", async () => {
		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[
				{ field: "subject", contains: "é" },
				{ field: "sender", contains: "bank.example" },
			],
			{ operator: "and" },
		);

		assert.deepEqual(
			result.items.map((item) => item.messageId),
			["quiet-sender"],
		);
	});

	test("drops the whole narrowing when an `or` branch cannot be evaluated", async () => {
		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[
				{ field: "subject", contains: "é" },
				{ field: "sender", contains: "bank.example" },
			],
			{ operator: "or", limit: 5 },
		);

		const found = result.items.map((item) => item.messageId);
		assert.ok(found.includes("accented"), "the dropped branch keeps its rows");
		assert.ok(
			found.some((messageId) => messageId.startsWith("noise-")),
			"a narrowed `or` would have excluded these",
		);
	});

	test("still narrows on a short ASCII term, which lower() folds correctly", async () => {
		const result = await repo.listByFieldTerms(ACCOUNT, [
			{ field: "sender", contains: "k." },
		]);

		assert.deepEqual(
			result.items.map((item) => item.messageId),
			["quiet-sender"],
		);
	});

	test("no terms narrows nothing", async () => {
		const result = await repo.listByFieldTerms(ACCOUNT, [], { limit: 3 });

		assert.equal(result.items.length, 3);
		assert.ok(result.continuationToken, "more rows remain");
	});

	test("stays inside the account and skips deleted rows on request", async () => {
		await repo.create(
			makeInput({
				accountConfigId: OTHER_ACCOUNT,
				messageId: "other-account",
				fromEmail: "noreply@bank.example",
			}),
		);
		await repo.create(
			makeInput({
				messageId: "deleted-match",
				mailboxId: ARCHIVE,
				fromEmail: "noreply@bank.example",
				isDeleted: true,
			}),
		);

		const result = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "sender", contains: "bank.example" }],
			{ excludeDeleted: true },
		);

		assert.deepEqual(
			result.items.map((item) => item.messageId),
			["quiet-sender"],
		);
	});

	test("pages the matches with a keyset cursor", async () => {
		const first = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "sender", contains: "other.example" }],
			{ limit: 2 },
		);
		assert.equal(first.items.length, 2);
		assert.ok(first.continuationToken);

		const second = await repo.listByFieldTerms(
			ACCOUNT,
			[{ field: "sender", contains: "other.example" }],
			{ limit: 2, continuationToken: first.continuationToken },
		);

		const overlap = second.items.filter((item) =>
			first.items.some((seen) => seen.messageId === item.messageId),
		);
		assert.deepEqual(overlap, [], "pages do not repeat a row");
	});
});
