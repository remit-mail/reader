import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, FilterItem, MailboxItem } from "@remit/data-ports";
import {
	FilterDisabledReason,
	FilterMatchOperator,
	FilterScope,
	FilterState,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import {
	createFilter,
	type FilterPatch,
	listFilters,
	type NewFilter,
	updateFilter,
} from "./filter-operations.js";
import type { Refusable } from "./refusal.js";
import {
	captureQueue,
	openStore,
	type QueueCapture,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let account: AccountItem;
let capture: QueueCapture;

const FANOUT_QUEUE = "http://localhost:4566/000000000000/account-fanout";

beforeEach(async () => {
	capture = captureQueue();
	store = await openStore();
	account = await seedAccount(store);
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

const deps = () => ({
	account: store.account,
	mailbox: store.mailbox,
	filter: store.filter,
	organizeJobRequest: store.organizeJobRequest,
	sqsQueueUrl: FANOUT_QUEUE,
	logger: { info: () => {} },
});

const rule = (actionMailboxId: string): NewFilter => ({
	name: "Receipts",
	scope: FilterScope.Standing,
	expiresAt: undefined,
	matchOperator: FilterMatchOperator.And,
	literalClauses: [{ field: "From", value: "billing@example.com" }],
	actionLabelId: "None",
	actionMailboxId,
});

const refusalOf = <T>(outcome: Refusable<T>) => {
	assert.equal(outcome.ok, false, "expected a refusal");
	return outcome.ok ? undefined : outcome.refusal;
};

const pendingFolder = async (fullPath: string): Promise<MailboxItem> => {
	const created = await store.mailbox.create({
		accountId: account.accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 0,
		uidNext: 1,
		highestModseq: "0",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		syncStatus: MailboxSyncStatus.pending,
	});
	if (created.outcome !== "Created") throw new Error(`${fullPath} exists`);
	return created.mailbox;
};

const storedFilter = (over: Partial<FilterItem>): Promise<FilterItem> =>
	store.filter.create({
		accountConfigId: account.accountConfigId,
		...rule("None"),
		...over,
	});

describe("createFilter", () => {
	it("stores the filter and queues its pass over existing mail", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		const outcome = await createFilter(
			deps(),
			{ accountConfigId: account.accountConfigId, userId: "user-1" },
			{ accountId: account.accountId, filter: rule(folder.mailboxId) },
		);

		assert.equal(outcome.ok, true);
		if (!outcome.ok) return;
		const job = await store.organizeJobRequest.get(
			outcome.value.organizeJob.organizeJobId,
		);
		assert.equal(job.filterId, outcome.value.filter.filterId);
		assert.equal(job.userId, "user-1");
		assert.deepEqual(job.literalClauses, []);
		assert.equal(job.actionMailboxId, "None");
		assert.deepEqual(capture.sent, [
			{
				queueUrl: FANOUT_QUEUE,
				body: {
					type: "OrganizeJob",
					accountConfigId: account.accountConfigId,
					organizeJobId: job.organizeJobId,
				},
			},
		]);
	});

	it("waits for the folder it moves mail into, storing nothing", async () => {
		const folder = await pendingFolder("Receipts");

		const outcome = await createFilter(
			deps(),
			{ accountConfigId: account.accountConfigId, userId: "user-1" },
			{ accountId: account.accountId, filter: rule(folder.mailboxId) },
		);

		assert.deepEqual(refusalOf(outcome), {
			kind: "NotSettled",
			message:
				"“Receipts” isn’t ready yet — the mail server hasn’t confirmed it.",
			mailboxId: folder.mailboxId,
			syncStatus: MailboxSyncStatus.pending,
		});
		assert.deepEqual(
			await store.filter.listByAccountConfig(account.accountConfigId),
			[],
		);
		assert.deepEqual(capture.sent, []);
	});

	it("refuses a Temporary filter without an expiry, storing nothing", async () => {
		const folder = await seedMailbox(store, account, "Receipts");

		const outcome = await createFilter(
			deps(),
			{ accountConfigId: account.accountConfigId, userId: "user-1" },
			{
				accountId: account.accountId,
				filter: { ...rule(folder.mailboxId), scope: FilterScope.Temporary },
			},
		);

		assert.deepEqual(refusalOf(outcome), {
			kind: "Invalid",
			message:
				"A Temporary filter needs expiresAt — pick a date, or switch scope to Standing.",
		});
		assert.deepEqual(
			await store.filter.listByAccountConfig(account.accountConfigId),
			[],
		);
	});
});

describe("updateFilter", () => {
	it("writes only the fields a patch may set, dropping server-derived ones", async () => {
		const filter = await storedFilter({});
		const smuggled: Record<string, unknown> = {
			name: "Bills",
			ttl: 123,
			disabledReason: FilterDisabledReason.FolderMissing,
			ruleChangedAt: 999,
			filterId: "sneaky",
		};

		const outcome = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: smuggled as FilterPatch,
		});

		assert.equal(outcome.ok, true);
		const stored = await store.filter.get(
			account.accountConfigId,
			filter.filterId,
		);
		assert.equal(stored.name, "Bills");
		assert.equal(stored.ttl, undefined);
		assert.equal(stored.disabledReason, FilterDisabledReason.None);
		assert.equal(stored.ruleChangedAt, filter.ruleChangedAt);
	});

	it("records UserDisabled when the user turns a filter off", async () => {
		const filter = await storedFilter({});

		await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: { state: FilterState.Disabled },
		});

		const stored = await store.filter.get(
			account.accountConfigId,
			filter.filterId,
		);
		assert.equal(stored.state, FilterState.Disabled);
		assert.equal(stored.disabledReason, FilterDisabledReason.UserDisabled);
	});

	it("refuses to bind to a folder the mail server has not confirmed", async () => {
		const filter = await storedFilter({});
		const folder = await pendingFolder("Receipts");

		const outcome = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: { actionMailboxId: folder.mailboxId },
		});

		assert.equal(refusalOf(outcome)?.kind, "NotSettled");
		const stored = await store.filter.get(
			account.accountConfigId,
			filter.filterId,
		);
		assert.equal(stored.actionMailboxId, "None");
	});

	it("will not turn on a filter whose folder is gone", async () => {
		const filter = await storedFilter({
			actionMailboxId: "mbx-gone",
			state: FilterState.Disabled,
			disabledReason: FilterDisabledReason.UserDisabled,
		});

		const outcome = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: { state: FilterState.Active },
		});

		assert.deepEqual(refusalOf(outcome), {
			kind: "Invalid",
			message:
				"The folder this filter moves mail into no longer exists. Pick another folder, then turn the filter on.",
		});
	});

	it("refuses a Temporary filter without an expiry", async () => {
		const filter = await storedFilter({});

		const outcome = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: { scope: FilterScope.Temporary },
		});

		assert.deepEqual(refusalOf(outcome), {
			kind: "Invalid",
			message:
				"A Temporary filter needs expiresAt — pick a date, or switch scope to Standing.",
		});
	});

	it("renames a filter", async () => {
		const filter = await storedFilter({});

		const outcome = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: filter.filterId,
			patch: { name: "Bills" },
		});

		assert.equal(outcome.ok && outcome.value.name, "Bills");
	});
});

describe("listFilters", () => {
	it("expires a lapsed Temporary filter as it reads it", async () => {
		await storedFilter({
			scope: FilterScope.Temporary,
			expiresAt: "2020-01-01T00:00:00+00:00",
		});

		const outcome = await listFilters(deps(), account.accountConfigId, {
			accountId: account.accountId,
			continuationToken: undefined,
		});

		assert.deepEqual(
			outcome.ok && outcome.value.items.map((item) => item.state),
			[FilterState.Expired],
		);
	});

	it("answers another tenant's account as not found", async () => {
		const other = await seedAccount(store, { accountConfigId: "cfg-other" });

		const outcome = await listFilters(deps(), account.accountConfigId, {
			accountId: other.accountId,
			continuationToken: undefined,
		});

		assert.deepEqual(refusalOf(outcome), {
			kind: "NotFound",
			message: `Account not found: ${other.accountId}`,
		});
	});
});
