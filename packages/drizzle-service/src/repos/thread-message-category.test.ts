import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import type { Db } from "../db.js";
import { threadMessageTable } from "../schema/thread-message.js";
import * as schema from "../schema.js";
import { createTestDb } from "../test-db.js";
import { categoryFixtureRows, TRIMMED_TOTALS } from "./category-fixture.js";
import { DrizzleThreadMessageRepository } from "./thread-message.js";

/**
 * The Postgres half of the category-predicate guard (#304). The behavioural
 * coverage is in thread-message.sqlite.test.ts against the full measured shape;
 * what this file exists for is the query plan, which is dialect-specific:
 * `EXPLAIN QUERY PLAN` is SQLite syntax and Postgres needs its own `EXPLAIN`.
 *
 * It runs against the embedded Postgres harness, which pushes the generated
 * drizzle schema, so `tm_by_mailbox_category_date` is present here for the same
 * reason it is present in the sqlite harness: the index is declared in TypeSpec
 * and emitted into the schema both dialects derive from. That is what makes the
 * assertion a real guard rather than a restatement of the predicate — remove the
 * index from the schema and it fails.
 *
 * The fixture is the measured shape with its common categories trimmed
 * (TRIMMED_TOTALS): the rare tail the assertions use is untouched, and the
 * planner needs only enough rows to prefer an index over a sequential scan. It
 * also needs statistics before it will, so the fixture is ANALYZEd; a production
 * instance gets that from autovacuum.
 */

const ACCOUNT = "acct-category-pg";
const MAILBOX = "mbx-category-pg";

describe("thread-message category predicate (postgres)", () => {
	let pool: pg.Pool;
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;
	const logged: Array<{ text: string; params: unknown[] }> = [];

	before(async () => {
		({ pool, close } = await createTestDb());

		const db = drizzle(pool, {
			schema,
			logger: {
				logQuery(text: string, params: unknown[]) {
					logged.push({ text, params });
				},
			},
		}) as unknown as Db<Record<string, unknown>>;
		repo = new DrizzleThreadMessageRepository(db);

		const rows = categoryFixtureRows({
			totals: TRIMMED_TOTALS,
			accountConfigId: ACCOUNT,
			mailboxId: MAILBOX,
		});
		const insertDb = drizzle(pool, { schema });
		for (let i = 0; i < rows.length; i += 500) {
			await insertDb.insert(threadMessageTable).values(rows.slice(i, i + 500));
		}
		await pool.query("ANALYZE thread_message");
	});

	after(async () => {
		await close();
	});

	test("a filtered page is a full page of matches, however far back they sit", async () => {
		const social = await repo.searchByMailboxWindow(
			ACCOUNT,
			MAILBOX,
			{ category: ["social"] },
			{ limit: 50, order: "desc", excludeDeleted: true },
		);
		assert.equal(social.items.length, 50);
		assert.ok(social.items.every((item) => item.category === "social"));
	});

	test("a continuation token walks the whole match set without repeats or gaps", async () => {
		const seen: string[] = [];
		let continuationToken: string | undefined;
		do {
			const page = await repo.searchByMailboxWindow(
				ACCOUNT,
				MAILBOX,
				{ category: ["social"] },
				{
					limit: 25,
					order: "desc",
					excludeDeleted: true,
					continuationToken,
				},
			);
			seen.push(...page.items.map((item) => item.threadMessageId));
			continuationToken = page.continuationToken;
		} while (continuationToken);
		assert.equal(seen.length, TRIMMED_TOTALS.social);
		assert.equal(new Set(seen).size, TRIMMED_TOTALS.social);
	});

	describe("query plan", () => {
		// Each assertion names the category column as well as the index: both
		// engines can reach this index on its (account_config_id, mailbox_id)
		// prefix alone, so an index-only assertion would still pass with the
		// predicate removed.
		const assertServedByIndex = async (
			run: () => Promise<unknown>,
		): Promise<void> => {
			logged.length = 0;
			await run();
			const selects = logged.filter((entry) => /^\s*select/i.test(entry.text));
			assert.ok(selects.length > 0, "the repo issued a select");
			const plan: string[] = [];
			for (const entry of selects) {
				const explained = await pool.query<{ "QUERY PLAN": string }>({
					text: `EXPLAIN ${entry.text}`,
					values: entry.params,
				});
				plan.push(...explained.rows.map((row) => row["QUERY PLAN"]));
			}
			const text = plan.join("\n");
			assert.ok(
				text.includes("tm_by_mailbox_category_date"),
				`no plan node used the index:\n${text}`,
			);
			assert.ok(
				/Index Cond:[^\n]*category/.test(text),
				`the index was used but not on category:\n${text}`,
			);
		};

		test("the filtered window is served by tm_by_mailbox_category_date", async () => {
			await assertServedByIndex(() =>
				repo.searchByMailboxWindow(
					ACCOUNT,
					MAILBOX,
					{ category: ["social"] },
					{ limit: 50, order: "desc", excludeDeleted: true },
				),
			);
		});

		test("the filtered count is served by tm_by_mailbox_category_date", async () => {
			await assertServedByIndex(() =>
				repo.countByMailbox(
					ACCOUNT,
					MAILBOX,
					{ category: ["social"] },
					{ excludeDeleted: true },
				),
			);
		});
	});
});
