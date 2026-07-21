import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { FilterScope, FilterState } from "@remit/domain-enums";
import { NotFoundError } from "../error.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { FilterRepo } from "./filter.js";

describe("FilterRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: FilterRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new FilterRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create fills in every defaulted field, never leaving it absent", async () => {
		const accountConfigId = randomId();
		const filter = await repo.create({
			accountConfigId,
			name: "Booking confirmations",
			scope: FilterScope.Standing,
		});

		assert.equal(filter.state, FilterState.Active);
		assert.equal(filter.hasAnchor, false);
		assert.equal(filter.literalClauses.length, 0);
		assert.equal(filter.actionLabelId, "None");
		assert.equal(filter.actionMailboxId, "None");
		assert.ok(
			filter.ruleChangedAt > 0,
			"ruleChangedAt should be set on create",
		);
		assert.equal(filter.expiresAt, undefined);
		assert.equal(filter.ttl, undefined);
	});

	test("a Temporary filter round-trips expiresAt and ttl", async () => {
		const accountConfigId = randomId();
		const expiresAt = "2026-08-01T00:00:00+02:00";
		const ttl = Math.floor(new Date(expiresAt).getTime() / 1000);

		const filter = await repo.create({
			accountConfigId,
			name: "Until my trip",
			scope: FilterScope.Temporary,
			expiresAt,
			ttl,
		});

		assert.equal(filter.scope, FilterScope.Temporary);
		assert.equal(filter.expiresAt, expiresAt);
		assert.equal(filter.ttl, ttl);
	});

	test("create round-trips literal clauses", async () => {
		const accountConfigId = randomId();
		const literalClauses = [
			{ field: "From", value: "billing@example.com" },
			{ field: "Subject", value: "invoice" },
		] as const;

		const filter = await repo.create({
			accountConfigId,
			name: "Invoices",
			scope: FilterScope.Standing,
			literalClauses: [...literalClauses],
		});

		assert.deepEqual(filter.literalClauses, literalClauses);
	});

	test("get throws NotFoundError for a missing filter", async () => {
		await assert.rejects(repo.get(randomId(), randomId()), NotFoundError);
	});

	test("update does not bump ruleChangedAt on a cosmetic rename", async () => {
		const accountConfigId = randomId();
		const filter = await repo.create({
			accountConfigId,
			name: "Newsletter admin",
			scope: FilterScope.Standing,
		});

		const renamed = await repo.update(accountConfigId, filter.filterId, {
			name: "Newsletter admin (renamed)",
		});

		assert.equal(renamed.name, "Newsletter admin (renamed)");
		assert.equal(
			renamed.ruleChangedAt,
			filter.ruleChangedAt,
			"a name-only edit must not move ruleChangedAt (RFC 034 Decision 3.2)",
		);
	});

	test("update bumps ruleChangedAt when the action changes", async () => {
		const accountConfigId = randomId();
		const filter = await repo.create({
			accountConfigId,
			name: "Move to archive",
			scope: FilterScope.Standing,
		});

		await new Promise((resolve) => setTimeout(resolve, 1100));

		const updated = await repo.update(accountConfigId, filter.filterId, {
			actionMailboxId: randomId(),
		});

		assert.ok(
			updated.ruleChangedAt > filter.ruleChangedAt,
			"an action edit must move ruleChangedAt forward",
		);
	});

	test("update throws NotFoundError for a missing filter", async () => {
		await assert.rejects(
			repo.update(randomId(), randomId(), { name: "x" }),
			NotFoundError,
		);
	});

	test("listByAccountConfig and listByAccountAndState scope to the account", async () => {
		const accountConfigId = randomId();
		const other = randomId();

		const standing = await repo.create({
			accountConfigId,
			name: "Standing",
			scope: FilterScope.Standing,
		});
		await repo.create({
			accountConfigId: other,
			name: "Foreign",
			scope: FilterScope.Standing,
		});

		const all = await repo.listByAccountConfig(accountConfigId);
		assert.equal(all.length, 1);
		assert.equal(all[0]?.filterId, standing.filterId);

		const active = await repo.listByAccountAndState(
			accountConfigId,
			FilterState.Active,
		);
		assert.equal(active.length, 1);
		assert.equal(active[0]?.filterId, standing.filterId);

		const expired = await repo.listByAccountAndState(
			accountConfigId,
			FilterState.Expired,
		);
		assert.equal(expired.length, 0);
	});

	test("refreshExpiry leaves a Standing filter untouched", async () => {
		const accountConfigId = randomId();
		const filter = await repo.create({
			accountConfigId,
			name: "Standing",
			scope: FilterScope.Standing,
		});

		const result = await repo.refreshExpiry(filter);
		assert.equal(result.state, FilterState.Active);
	});

	test("refreshExpiry leaves a not-yet-expired Temporary filter Active", async () => {
		const accountConfigId = randomId();
		const future = new Date(Date.now() + 86_400_000).toISOString();
		const filter = await repo.create({
			accountConfigId,
			name: "Until tomorrow",
			scope: FilterScope.Temporary,
			expiresAt: future,
			ttl: Math.floor(new Date(future).getTime() / 1000),
		});

		const result = await repo.refreshExpiry(filter);
		assert.equal(result.state, FilterState.Active);
	});

	test("refreshExpiry lazily patches a past-expiresAt Temporary filter to Expired", async () => {
		const accountConfigId = randomId();
		const past = new Date(Date.now() - 86_400_000).toISOString();
		const filter = await repo.create({
			accountConfigId,
			name: "Until yesterday",
			scope: FilterScope.Temporary,
			expiresAt: past,
			ttl: Math.floor(new Date(past).getTime() / 1000) + 172_800,
		});

		assert.equal(filter.state, FilterState.Active, "starts Active on create");

		const result = await repo.refreshExpiry(filter);
		assert.equal(result.state, FilterState.Expired);

		const reread = await repo.get(accountConfigId, filter.filterId);
		assert.equal(
			reread.state,
			FilterState.Expired,
			"the patch is persisted, not just returned",
		);
	});

	test("delete removes the row", async () => {
		const accountConfigId = randomId();
		const filter = await repo.create({
			accountConfigId,
			name: "To delete",
			scope: FilterScope.Standing,
		});

		await repo.delete(accountConfigId, filter.filterId);

		await assert.rejects(
			repo.get(accountConfigId, filter.filterId),
			NotFoundError,
		);
	});

	test("listPageByAccountConfig round-trips a continuationToken across pages", async () => {
		const accountConfigId = randomId();
		const created = await Promise.all([
			repo.create({
				accountConfigId,
				name: "One",
				scope: FilterScope.Standing,
			}),
			repo.create({
				accountConfigId,
				name: "Two",
				scope: FilterScope.Standing,
			}),
			repo.create({
				accountConfigId,
				name: "Three",
				scope: FilterScope.Standing,
			}),
		]);

		const first = await repo.listPageByAccountConfig(accountConfigId, {
			limit: 2,
		});
		assert.equal(first.items.length, 2);
		assert.ok(
			first.continuationToken,
			"a full page returns a continuationToken",
		);

		const second = await repo.listPageByAccountConfig(accountConfigId, {
			limit: 2,
			continuationToken: first.continuationToken,
		});
		assert.equal(second.items.length, 1);
		assert.equal(
			second.continuationToken,
			undefined,
			"the last page carries no continuationToken",
		);

		const seen = new Set([
			...first.items.map((f) => f.filterId),
			...second.items.map((f) => f.filterId),
		]);
		assert.equal(
			seen.size,
			created.length,
			"every filter is paged exactly once",
		);
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
						repo.listPageByAccountConfig(randomId(), {
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
});
