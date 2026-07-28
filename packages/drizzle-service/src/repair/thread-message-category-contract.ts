/**
 * The behaviour `thread_message.category`'s repair (#321) must have, asserted
 * against a real engine from one place.
 *
 * Every seed is raw SQL against the real column names, so it exercises the same
 * statement text the migrator runs rather than a drizzle re-spelling of it.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	type CategoryDivergenceReport,
	checkThreadMessageCategory,
	formatCheckReport,
	formatRepairResult,
	formatRepairSkipped,
	type RepairSqlClient,
	readResidual,
	repairThreadMessageCategory,
} from "./thread-message-category.js";

export type RepairHarness = {
	readonly client: RepairSqlClient;
	readonly reset: () => Promise<void>;
	readonly close: () => Promise<void>;
};

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

type MessageSeed = {
	readonly messageId: string;
	readonly category: string;
};

type ThreadMessageSeed = {
	readonly threadMessageId: string;
	readonly messageId: string;
	readonly category: string;
	readonly mailboxId?: string;
	readonly updatedAt?: number;
};

const insertMessage = ({ messageId, category }: MessageSeed): string =>
	`INSERT INTO message (
		message_id, mailbox_id, uid, sequence_number, rfc822_size, internal_date,
		envelope_id, root_body_part_id, category, created_at, updated_at
	) VALUES (
		${literal(messageId)}, 'mbx-inbox', 1, 1, 100, 0,
		'env-1', 'part-1', ${literal(category)}, 0, 0
	)`;

const insertThreadMessage = ({
	threadMessageId,
	messageId,
	category,
	mailboxId = "mbx-inbox",
	updatedAt = 1000,
}: ThreadMessageSeed): string =>
	`INSERT INTO thread_message (
		thread_message_id, thread_id, message_id, account_config_id, mailbox_id, uid,
		reference_order, internal_date, sent_date, is_read, has_attachment, has_stars,
		is_deleted, category, created_at, updated_at
	) VALUES (
		${literal(threadMessageId)}, 'thr-1', ${literal(messageId)}, 'acct-1',
		${literal(mailboxId)}, 1, 0, 0, 0, false, false, false, false,
		${literal(category)}, 0, ${updatedAt}
	)`;

type ThreadMessageRow = {
	readonly threadMessageId: string;
	readonly category: string;
	readonly updatedAt: number;
};

const readRows = async (
	client: RepairSqlClient,
): Promise<ThreadMessageRow[]> => {
	const rows = await client.all(
		"SELECT thread_message_id, category, updated_at FROM thread_message ORDER BY thread_message_id",
	);
	return rows.map((row) => {
		if (typeof row !== "object" || row === null) {
			throw new Error("expected a row object");
		}
		const record: Record<string, unknown> = { ...row };
		return {
			threadMessageId: String(record.thread_message_id),
			category: String(record.category),
			updatedAt: Number(record.updated_at),
		};
	});
};

const categoryOf = (
	rows: readonly ThreadMessageRow[],
	threadMessageId: string,
): string => {
	const row = rows.find((entry) => entry.threadMessageId === threadMessageId);
	if (!row) {
		throw new Error(`no thread_message row ${threadMessageId}`);
	}
	return row.category;
};

export const describeRepairContract = (
	label: string,
	open: () => Promise<RepairHarness>,
): void => {
	describe(`thread_message.category repair — ${label}`, () => {
		let harness: RepairHarness;

		before(async () => {
			harness = await open();
		});

		after(async () => {
			await harness.close();
		});

		beforeEach(async () => {
			await harness.reset();
		});

		const seed = async (
			messages: readonly MessageSeed[],
			threadMessages: readonly ThreadMessageSeed[],
		): Promise<void> => {
			for (const message of messages) {
				await harness.client.run(insertMessage(message));
			}
			for (const threadMessage of threadMessages) {
				await harness.client.run(insertThreadMessage(threadMessage));
			}
		};

		const check = (): Promise<CategoryDivergenceReport> =>
			checkThreadMessageCategory(harness.client);

		test("repairs a stale row and does not touch a matching one", async () => {
			await seed(
				[
					{ messageId: "msg-stale", category: "newsletter" },
					{ messageId: "msg-agrees", category: "social" },
				],
				[
					{
						threadMessageId: "tm-stale",
						messageId: "msg-stale",
						category: "uncategorized",
					},
					{
						threadMessageId: "tm-agrees",
						messageId: "msg-agrees",
						category: "social",
						updatedAt: 4242,
					},
				],
			);

			const before = await check();
			assert.equal(before.rows, 2);
			assert.equal(before.divergent, 1);
			assert.equal(before.repairable, 1);
			assert.equal(before.behind, 1);
			assert.equal(before.crossed, 0);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 1);

			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-stale"), "newsletter");
			assert.equal(categoryOf(rows, "tm-agrees"), "social");

			const untouched = rows.find(
				(row) => row.threadMessageId === "tm-agrees",
			)?.updatedAt;
			assert.equal(untouched, 4242);

			const after = await check();
			assert.equal(after.divergent, 0);
			assert.equal(after.repairable, 0);
		});

		test("repairs a row classified differently from its message", async () => {
			await seed(
				[{ messageId: "msg-crossed", category: "marketing" }],
				[
					{
						threadMessageId: "tm-crossed",
						messageId: "msg-crossed",
						category: "personal",
					},
				],
			);

			const before = await check();
			assert.equal(before.crossed, 1);
			assert.equal(before.behind, 0);
			assert.equal(before.repairable, 1);

			await repairThreadMessageCategory(harness.client);
			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-crossed"), "marketing");
		});

		test("leaves a row pending when its message is pending", async () => {
			await seed(
				[{ messageId: "msg-pending", category: "uncategorized" }],
				[
					{
						threadMessageId: "tm-pending",
						messageId: "msg-pending",
						category: "uncategorized",
					},
				],
			);

			const before = await check();
			assert.equal(before.notYetClassified, 1);
			assert.equal(before.divergent, 0);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 0);

			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-pending"), "uncategorized");
			assert.equal((await check()).notYetClassified, 1);
		});

		// `uncategorized` is a declared pending state, not absence (#45). After #326
		// body-sync writes the row before the message, so a row classified against a
		// pending message is a classification in flight — pushing it back would undo
		// a correct classification and serve Unclassified for classified mail. This
		// is #326's closing question, answered: the row is left alone, not converged.
		test("never copies pending over a classified row", async () => {
			await seed(
				[{ messageId: "msg-ahead", category: "uncategorized" }],
				[
					{
						threadMessageId: "tm-ahead",
						messageId: "msg-ahead",
						category: "personal",
					},
				],
			);

			const before = await check();
			assert.equal(before.divergent, 1);
			assert.equal(before.ahead, 1);
			assert.equal(before.repairable, 0);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 0);

			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-ahead"), "personal");
			assert.match(
				formatCheckReport(await check()).join("\n"),
				/ahead: 1 row .*Expected non-zero on a live instance mid-sync/,
			);
		});

		test("leaves a row with no message row alone and counts it", async () => {
			await seed(
				[],
				[
					{
						threadMessageId: "tm-orphan",
						messageId: "msg-absent",
						category: "personal",
					},
				],
			);

			const before = await check();
			assert.equal(before.rows, 1);
			assert.equal(before.rowsWithMessage, 0);
			assert.equal(before.orphanRows, 1);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 0);
			assert.equal(
				categoryOf(await readRows(harness.client), "tm-orphan"),
				"personal",
			);
		});

		test("repairs every row of a message held in two mailboxes", async () => {
			await seed(
				[{ messageId: "msg-fanned", category: "transactional" }],
				[
					{
						threadMessageId: "tm-inbox",
						messageId: "msg-fanned",
						category: "uncategorized",
					},
					{
						threadMessageId: "tm-archive",
						messageId: "msg-fanned",
						mailboxId: "mbx-archive",
						category: "uncategorized",
					},
				],
			);

			const before = await check();
			assert.equal(before.fanOutMessages, 1);
			assert.equal(before.fanOutRows, 2);
			assert.deepEqual(before.divergentByMailbox, [
				{ mailboxId: "mbx-archive", rows: 1 },
				{ mailboxId: "mbx-inbox", rows: 1 },
			]);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 2);

			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-inbox"), "transactional");
			assert.equal(categoryOf(rows, "tm-archive"), "transactional");
			assert.equal((await check()).divergent, 0);
		});

		test("is a no-op on the second run", async () => {
			await seed(
				[{ messageId: "msg-twice", category: "automated" }],
				[
					{
						threadMessageId: "tm-twice",
						messageId: "msg-twice",
						category: "uncategorized",
					},
				],
			);

			assert.equal(
				(await repairThreadMessageCategory(harness.client)).rowsWritten,
				1,
			);
			const afterFirst = await readRows(harness.client);
			assert.equal(
				(await repairThreadMessageCategory(harness.client)).rowsWritten,
				0,
			);
			assert.deepEqual(await readRows(harness.client), afterFirst);
		});

		// The guard's mechanics: a row whose stamp is beyond the statement's clock
		// fails the WHERE clause and is left alone. A row stamped that far ahead is
		// not a concurrent writer — it is a clock that jumped or a restored backup —
		// and the residual has to say so, because that row fails the guard on every
		// run and no later start will fix it.
		test("skips a row stamped beyond the statement's clock and says why", async () => {
			await seed(
				[
					{ messageId: "msg-ahead-clock", category: "newsletter" },
					{ messageId: "msg-quiet", category: "newsletter" },
				],
				[
					{
						threadMessageId: "tm-ahead-clock",
						messageId: "msg-ahead-clock",
						category: "uncategorized",
						updatedAt: Date.now() + 600_000,
					},
					{
						threadMessageId: "tm-quiet",
						messageId: "msg-quiet",
						category: "uncategorized",
					},
				],
			);

			const result = await repairThreadMessageCategory(harness.client);
			assert.equal(result.rowsWritten, 1);

			const rows = await readRows(harness.client);
			assert.equal(categoryOf(rows, "tm-ahead-clock"), "uncategorized");
			assert.equal(categoryOf(rows, "tm-quiet"), "newsletter");

			const residual = await readResidual(harness.client);
			assert.deepEqual(residual, { repairable: 1, aheadOfClock: 1 });

			const reported = formatRepairResult(result, residual).join("\n");
			assert.match(reported, /ahead of the database clock/);
			assert.match(reported, /every run, not just this one/);
			assert.ok(
				!reported.includes("skipped because a writer touched them"),
				"a clock-ahead row must not be reported as a concurrent writer",
			);
		});

		test("names the concurrent writer and the update cadence when a run leaves a residual", () => {
			const reported = formatRepairResult(
				{ rowsWritten: 4, elapsedMs: 7 },
				{ repairable: 2, aheadOfClock: 0 },
			).join("\n");
			assert.match(reported, /2 rows skipped because a writer touched them/);
			assert.match(reported, /the next 'remit update'/);
			assert.ok(!reported.includes("ahead of the database clock"));
		});

		test("a clean run reports no warning at all", () => {
			assert.deepEqual(
				formatRepairResult(
					{ rowsWritten: 3, elapsedMs: 2 },
					{ repairable: 0, aheadOfClock: 0 },
				),
				[
					"repair wrote 3 rows in 2ms",
					"residual repairable divergence: 0 (expected zero)",
				],
			);
		});

		test("a skipped repair says no write lock was taken", async () => {
			await seed(
				[{ messageId: "msg-clean", category: "personal" }],
				[
					{
						threadMessageId: "tm-clean",
						messageId: "msg-clean",
						category: "personal",
					},
				],
			);

			const report = await check();
			assert.equal(report.repairable, 0);
			assert.match(
				formatRepairSkipped(report).join("\n"),
				/repair skipped: nothing repairable .*No write, so no write lock is taken\./,
			);
		});

		test("--check writes nothing", async () => {
			await seed(
				[{ messageId: "msg-readonly", category: "personal" }],
				[
					{
						threadMessageId: "tm-readonly",
						messageId: "msg-readonly",
						category: "uncategorized",
						updatedAt: 7777,
					},
				],
			);

			const rowsBefore = await readRows(harness.client);
			await check();
			assert.deepEqual(await readRows(harness.client), rowsBefore);
		});

		test("the report names a cause and its expected result for every figure", async () => {
			await seed(
				[{ messageId: "msg-report", category: "social" }],
				[
					{
						threadMessageId: "tm-report",
						messageId: "msg-report",
						category: "uncategorized",
					},
				],
			);

			const lines = formatCheckReport(await check());
			const text = lines.join("\n");

			for (const cause of [
				"behind:",
				"crossed:",
				"ahead:",
				"fan-out:",
				"orphans:",
				"not-yet-classified:",
				"divergent per mailbox:",
				"category tally:",
			]) {
				assert.ok(text.includes(cause), `missing cause: ${cause}`);
			}
			assert.equal(
				lines.filter((line) => /Expected (zero|non-zero)/.test(line)).length,
				6,
			);
			assert.match(text, /category tally: uncategorized=1/);
		});

		// The causes are the deliverable, so each one names something that can
		// actually happen on the deployment this repair ships to. A cause an
		// operator can rule out by inspection reads as a broken figure.
		test("no figure cites a cause that cannot occur on this deployment", async () => {
			const text = formatCheckReport(await check()).join("\n");
			for (const stale of [
				"2026-07-08",
				"drizzle push",
				"instance whose column was added",
			]) {
				assert.ok(
					!text.includes(stale),
					`the report still cites ${stale}, which no SQLite instance can have experienced`,
				);
			}
			assert.match(text, /behind: .*write-path defects #326 fixes end here/);
			assert.match(text, /crossed: .*no write path leaves a row here/);
		});
	});
};
