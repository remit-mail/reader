import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
	CreateFilterInput,
	UpdateFilterInput as UpdateFilterRequestBody,
} from "@remit/api-openapi-types";
import type {
	CreateOrganizeJobRequestInput,
	FilterItem,
} from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	FilterDisabledReason,
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import {
	FilterOperations,
	pickFilterUpdate,
	resolveFilterScopeExpiry,
	resolveFilterUpdate,
} from "./filter.js";

describe("pickFilterUpdate", () => {
	it("carries scope and expiresAt through, alongside the predicate/action fields", () => {
		const patch = pickFilterUpdate({
			scope: FilterScope.Temporary,
			expiresAt: "2027-01-01T00:00:00+00:00",
			matchOperator: "Or",
		});
		assert.equal(patch.scope, FilterScope.Temporary);
		assert.equal(patch.expiresAt, "2027-01-01T00:00:00+00:00");
		assert.equal(patch.matchOperator, "Or");
	});

	it("leaves scope/expiresAt absent when the body doesn't touch them", () => {
		const patch = pickFilterUpdate({ name: "Receipts" });
		assert.equal("scope" in patch, false);
		assert.equal("expiresAt" in patch, false);
	});

	it("drops any server-derived field smuggled into the body", () => {
		const raw: Record<string, unknown> = {
			name: "Receipts",
			ttl: 123,
			disabledReason: "None",
			ruleChangedAt: 999,
			filterId: "sneaky",
		};
		const patch = pickFilterUpdate(raw as Partial<UpdateFilterRequestBody>);
		assert.deepEqual(patch, { name: "Receipts" });
	});
});

describe("resolveFilterUpdate (#1103)", () => {
	const NOW = Date.parse("2026-09-25T12:00:00Z");
	const standing = {
		scope: FilterScope.Standing,
		expiresAt: undefined,
		state: FilterState.Active,
		disabledReason: FilterDisabledReason.None,
		actionMailboxId: "mbx-invoices",
	};

	it("carries a state the body names through to the patch", () => {
		assert.equal(
			pickFilterUpdate({ state: FilterState.Disabled }).state,
			FilterState.Disabled,
		);
	});

	it("records UserDisabled when the user turns a filter off", () => {
		assert.deepEqual(
			resolveFilterUpdate(standing, { state: FilterState.Disabled }, NOW),
			{
				state: FilterState.Disabled,
				disabledReason: FilterDisabledReason.UserDisabled,
			},
		);
	});

	for (const reason of [
		FilterDisabledReason.UserDisabled,
		FilterDisabledReason.AwaitingFolder,
		FilterDisabledReason.FolderCreateFailed,
		FilterDisabledReason.FolderMissing,
	]) {
		it(`clears ${reason} when the user turns the filter back on`, () => {
			assert.deepEqual(
				resolveFilterUpdate(
					{
						...standing,
						state: FilterState.Disabled,
						disabledReason: reason,
					},
					{ state: FilterState.Active },
					NOW,
				),
				{
					state: FilterState.Active,
					disabledReason: FilterDisabledReason.None,
				},
			);
		});
	}

	it("keeps a disabled filter disabled, with its reason, through an expiry edit", () => {
		const resolved = resolveFilterUpdate(
			{ ...standing, state: FilterState.Disabled },
			{
				scope: FilterScope.Temporary,
				expiresAt: "2027-01-01T00:00:00+00:00",
			},
			NOW,
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
	});

	for (const reason of [
		FilterDisabledReason.AwaitingFolder,
		FilterDisabledReason.FolderCreateFailed,
	]) {
		it(`refuses to turn on a ${reason} filter that has no folder`, () => {
			assert.throws(
				() =>
					resolveFilterUpdate(
						{
							...standing,
							state: FilterState.Disabled,
							disabledReason: reason,
							actionMailboxId: "None",
						},
						{ state: FilterState.Active },
						NOW,
					),
				/pick a folder in the rule/i,
			);
		});

		it(`turns on a ${reason} filter once the patch names a folder`, () => {
			assert.equal(
				resolveFilterUpdate(
					{
						...standing,
						state: FilterState.Disabled,
						disabledReason: reason,
						actionMailboxId: "None",
					},
					{ state: FilterState.Active, actionMailboxId: "mbx-picked" },
					NOW,
				).state,
				FilterState.Active,
			);
		});
	}

	const awaiting = {
		...standing,
		state: FilterState.Disabled,
		disabledReason: FilterDisabledReason.AwaitingFolder,
		actionMailboxId: "None",
	};

	it("keeps a folderless reason when the user turns an awaiting filter off again", () => {
		const resolved = resolveFilterUpdate(
			awaiting,
			{ state: FilterState.Disabled },
			NOW,
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
		assert.throws(
			() =>
				resolveFilterUpdate(
					{ ...awaiting, state: resolved.state ?? awaiting.state },
					{ state: FilterState.Active },
					NOW,
				),
			/pick a folder in the rule/i,
		);
	});

	it("keeps a lapsed folderless filter off when its date moves forward", () => {
		const lapsed = {
			...awaiting,
			scope: FilterScope.Temporary,
			expiresAt: "2026-01-01T00:00:00+00:00",
			disabledReason: FilterDisabledReason.FolderCreateFailed,
		};
		const resolved = resolveFilterUpdate(
			lapsed,
			{
				scope: FilterScope.Temporary,
				expiresAt: "2027-01-01T00:00:00+00:00",
			},
			NOW,
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
		assert.throws(
			() =>
				resolveFilterUpdate(
					{ ...lapsed, expiresAt: "2027-01-01T00:00:00+00:00" },
					{ state: FilterState.Active },
					NOW,
				),
			/pick a folder in the rule/i,
		);
	});

	it("marks a folderless filter UserDisabled once the user picks a folder", () => {
		assert.deepEqual(
			resolveFilterUpdate(awaiting, { actionMailboxId: "mbx-picked" }, NOW),
			{
				actionMailboxId: "mbx-picked",
				disabledReason: FilterDisabledReason.UserDisabled,
			},
		);
	});

	it("refuses Expired as a state the user sets", () => {
		assert.throws(
			() => resolveFilterUpdate(standing, { state: FilterState.Expired }, NOW),
			/expires through its date/,
		);
	});

	it("refuses to turn on a temporary filter whose date has passed", () => {
		assert.throws(
			() =>
				resolveFilterUpdate(
					{
						...standing,
						scope: FilterScope.Temporary,
						expiresAt: "2026-01-01T00:00:00+00:00",
						state: FilterState.Disabled,
					},
					{ state: FilterState.Active },
					NOW,
				),
			/has expired/,
		);
	});

	it("leaves a patch that names neither state nor timing untouched", () => {
		assert.deepEqual(resolveFilterUpdate(standing, { name: "Receipts" }, NOW), {
			name: "Receipts",
		});
	});
});

describe("resolveFilterScopeExpiry (reader #266)", () => {
	it("moves Standing to Temporary given a future expiresAt", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Standing, expiresAt: undefined },
			{ scope: FilterScope.Temporary, expiresAt: "2099-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.scope, FilterScope.Temporary);
		assert.equal(resolved.expiresAt, "2099-01-01T00:00:00+00:00");
		assert.equal(resolved.state, FilterState.Active);
		assert.ok(resolved.ttl && resolved.ttl > 0);
	});

	it("rejects moving to Temporary without an expiresAt", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ scope: FilterScope.Temporary },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				assert.match((error as Error).message, /needs expiresAt/);
				return true;
			},
		);
	});

	it("rejects an expiresAt patch that isn't paired with a Temporary scope", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ expiresAt: "2099-01-01T00:00:00+00:00" },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				assert.match((error as Error).message, /only applies to a Temporary/);
				return true;
			},
		);
	});

	it("clears expiresAt/ttl and reports Active when moving Temporary to Standing", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2020-01-01T00:00:00+00:00" },
			{ scope: FilterScope.Standing },
		);
		assert.equal(resolved.scope, FilterScope.Standing);
		assert.equal(resolved.expiresAt, undefined);
		assert.equal(resolved.ttl, undefined);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("recomputes ttl for an expiresAt-only change on an already-Temporary filter", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2026-08-01T00:00:00+00:00" },
			{ expiresAt: "2099-06-01T00:00:00+00:00" },
		);
		assert.equal(resolved.scope, FilterScope.Temporary);
		assert.equal(resolved.expiresAt, "2099-06-01T00:00:00+00:00");
		assert.equal(
			resolved.ttl,
			Math.floor(new Date("2099-06-01T00:00:00+00:00").getTime() / 1000),
		);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("reactivates a lapsed filter extended into the future", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2020-01-01T00:00:00+00:00" },
			{ expiresAt: "2099-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("reads Expired immediately when the new expiresAt is already in the past", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2099-01-01T00:00:00+00:00" },
			{ expiresAt: "2020-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.state, FilterState.Expired);
	});

	it("rejects an unparseable expiresAt", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ scope: FilterScope.Temporary, expiresAt: "not-a-date" },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				return true;
			},
		);
	});
});

describe("createFilter queues the new filter's pass over the inbox (#1354)", () => {
	const SUB = "cognito-sub-1354";
	const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
	const ACCOUNT_ID = "acc-1354";

	const created: FilterItem = {
		filterId: "flt-new",
		accountConfigId: ACCOUNT_CONFIG_ID,
		name: "Invoices",
		scope: FilterScope.Standing,
		state: FilterState.Active,
		disabledReason: "None",
		ruleChangedAt: 1,
		actionChangedAt: 1,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [{ field: "From", value: "billing@example.com" }],
		actionLabelId: "None",
		actionMailboxId: "mbx-invoices",
		createdAt: 0,
		updatedAt: 0,
	};

	afterEach(() => {
		mock.restoreAll();
		_resetForTest();
	});

	const world = (filter: FilterItem) => {
		process.env.SQS_QUEUE_URL_ACCOUNT_FANOUT =
			"http://localhost:9324/queue/account-fanout-test";
		const jobs: CreateOrganizeJobRequestInput[] = [];
		const enqueued: SendMessageCommand[] = [];
		mock.method(sqsClient, "send", async (command: SendMessageCommand) => {
			enqueued.push(command);
			return {};
		});
		setClient({
			account: {
				get: async () => ({
					accountId: ACCOUNT_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
				}),
			},
			mailbox: {
				get: async () => ({
					mailboxId: "mbx-invoices",
					accountId: ACCOUNT_ID,
					fullPath: "Invoices",
					syncStatus: "synced",
				}),
			},
			filter: { create: async () => filter },
			organizeJobRequest: {
				create: async (input: CreateOrganizeJobRequestInput) => {
					jobs.push(input);
					return { ...input, organizeJobId: "job-new", state: "Pending" };
				},
			},
		} as unknown as RemitClient);
		return { jobs, enqueued };
	};

	const createFilter = (body: Partial<CreateFilterInput>) =>
		(
			FilterOperations.FilterOperations_createFilter as (
				context: Context,
				event: APIGatewayProxyEvent,
			) => Promise<Record<string, unknown>>
		)(
			{
				request: {
					params: { accountId: ACCOUNT_ID },
					requestBody: {
						name: created.name,
						scope: created.scope,
						matchOperator: created.matchOperator,
						literalClauses: created.literalClauses,
						actionLabelId: created.actionLabelId,
						actionMailboxId: created.actionMailboxId,
						...body,
					},
				},
			} as unknown as Context,
			{
				requestContext: { authorizer: { claims: { sub: SUB } } },
			} as unknown as APIGatewayProxyEvent,
		);

	it("queues an organize job for the created filter and returns its id", async () => {
		const { jobs, enqueued } = world(created);

		const response = await createFilter({});

		assert.equal(jobs.length, 1);
		assert.equal(jobs[0]?.filterId, "flt-new");
		assert.equal(enqueued.length, 1);
		assert.match(String(enqueued[0]?.input.MessageBody), /job-new/);
		assert.equal(response.organizeJobId, "job-new");
		assert.equal(response.filterId, "flt-new");
	});

	it("names only the filter: the predicate columns stay at their sentinels", async () => {
		const { jobs } = world(created);

		await createFilter({});

		assert.deepEqual(jobs[0]?.literalClauses, []);
		assert.equal(jobs[0]?.actionLabelId, "None");
		assert.equal(jobs[0]?.actionMailboxId, "None");
	});
});
