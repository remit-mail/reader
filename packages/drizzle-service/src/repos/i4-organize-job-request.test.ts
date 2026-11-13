import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { filterRuleFromClauses } from "@remit/data-ports";
import { FilterClauseField, FilterMatchOperator } from "@remit/domain-enums";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { organizeJobRequestTable } from "../schema/i4-organize-job-request.js";
import { createTestDb, randomId } from "../test-db.js";
import { OrganizeJobRequestRepo } from "./i4-organize-job-request.js";

describe("OrganizeJobRequestRepo", () => {
	let db: Db;
	let close: () => Promise<void>;
	let repo: OrganizeJobRequestRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new OrganizeJobRequestRepo(db as never);
	});

	after(async () => {
		await close();
	});

	describe("continuation token rejection (#172)", () => {
		for (const [label, token] of [
			["an unparseable", "not-a-cursor"],
			["a bare number", Buffer.from("123").toString("base64url")],
			["a JSON array", Buffer.from("[1,2]").toString("base64url")],
		] as const) {
			test(`${label} token is rejected as a 400`, async () => {
				await assert.rejects(
					() =>
						repo.listByAccountConfig(randomId(), {
							continuationToken: token,
						}),
					(error: unknown) => {
						assert.equal((error as { statusCode?: number }).statusCode, 400);
						assert.equal((error as Error).name, "BadRequestError");
						return true;
					},
				);
			});
		}
	});

	describe("stored rule (#1621)", () => {
		const literalClauses = [
			{ field: FilterClauseField.Subject, value: "invoice" },
			{ field: FilterClauseField.HasWords, value: "overdue" },
		];

		const storedRule = async (organizeJobId: string) => {
			const [row] = await db
				.select({
					rule: organizeJobRequestTable.rule,
					literalClauses: organizeJobRequestTable.literalClauses,
				})
				.from(organizeJobRequestTable)
				.where(eq(organizeJobRequestTable.organizeJobId, organizeJobId));
			return row;
		};

		test("a version 0 row reads as version 1 and stays version 0", async () => {
			const organizeJobId = randomId();
			await db.insert(organizeJobRequestTable).values({
				organizeJobId,
				accountConfigId: randomId(),
				userId: randomId(),
				matchOperator: FilterMatchOperator.Or,
				literalClauses,
				ttl: 0,
				createdAt: 0,
				updatedAt: 0,
			});

			const job = await repo.get(organizeJobId);

			assert.equal(job.matchOperator, FilterMatchOperator.Or);
			assert.deepEqual(job.literalClauses, literalClauses);
			assert.deepEqual(
				job.rule,
				filterRuleFromClauses({
					matchOperator: FilterMatchOperator.Or,
					literalClauses,
				}),
			);
			assert.deepEqual(await storedRule(organizeJobId), {
				rule: { version: 0 },
				literalClauses,
			});
		});

		test("create stores version 1 with empty clauses", async () => {
			const job = await repo.create({
				accountConfigId: randomId(),
				userId: randomId(),
				filterId: "None",
				rule: filterRuleFromClauses({
					matchOperator: FilterMatchOperator.And,
					literalClauses,
				}),
				actionLabelId: "None",
				actionMailboxId: "None",
				sourceMailboxId: "None",
				ttl: 0,
			});

			assert.equal(job.matchOperator, FilterMatchOperator.And);
			assert.deepEqual(job.literalClauses, literalClauses);
			assert.deepEqual(await storedRule(job.organizeJobId), {
				rule: filterRuleFromClauses({
					matchOperator: FilterMatchOperator.And,
					literalClauses,
				}),
				literalClauses: [],
			});
		});
	});
});
