import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	type AccountItem,
	type FilterItem,
	filterRuleFromClauses,
	type MailboxItem,
} from "@remit/data-ports";
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
	listAccountFilters,
	listFilters,
	type NewFilter,
	updateFilter,
} from "./filter-operations.js";
import type { Refusable } from "./refusal.js";
import {
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

let store: Store;
let account: AccountItem;
let capture: RecordingQueue;

beforeEach(async () => {
	capture = recordingQueue();
	store = await openStore();
	account = await seedAccount(store);
});

afterEach(async () => {
	await store.close();
});

const deps = () => ({
	account: store.account,
	mailbox: store.mailbox,
	label: store.label,
	labelMailbox: store.labelMailbox,
	filter: store.filter,
	organizeJobRequest: store.organizeJobRequest,
	queue: capture,
	logger: { info: () => {} },
});

const rule = (actionMailboxId: string): NewFilter => ({
	name: "Receipts",
	scope: FilterScope.Standing,
	expiresAt: undefined,
	matchOperator: FilterMatchOperator.And,
	literalClauses: [{ field: "From", value: "billing@example.com" }],
	priority: 0,
	stop: false,
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

const storedFilter = (over: Partial<FilterItem>): Promise<FilterItem> => {
	const { literalClauses, matchOperator, ...fields } = rule("None");
	return store.filter.create({
		accountConfigId: account.accountConfigId,
		...fields,
		rule: filterRuleFromClauses({
			matchOperator,
			literalClauses: literalClauses ?? [],
		}),
		...over,
	});
};

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
				body: {
					type: "OrganizeJob",
					accountConfigId: account.accountConfigId,
					organizeJobId: job.organizeJobId,
				},
				groupId: undefined,
				deduplicationId: undefined,
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

	it("stores priority 0 and stop false when the request omits them", async () => {
		const { priority: _priority, stop: _stop, ...filter } = rule("None");

		const outcome = await createFilter(
			deps(),
			{ accountConfigId: account.accountConfigId, userId: "user-1" },
			{ accountId: account.accountId, filter },
		);

		assert.equal(outcome.ok, true);
		if (!outcome.ok) return;
		const stored = await store.filter.get(
			account.accountConfigId,
			outcome.value.filter.filterId,
		);
		assert.equal(stored.priority, 0);
		assert.equal(stored.stop, false);
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

describe("listAccountFilters", () => {
	it("lists a folder move under its folder's account and every other filter under each account", async () => {
		const sibling = await store.account.create({
			accountConfigId: account.accountConfigId,
			username: "me-too@example.com",
			email: "me-too@example.com",
			authType: account.authType,
			passwordHash: '{"ciphertext":"x"}',
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: account.connectionState,
		});
		const mine = await seedMailbox(store, account, "Receipts");
		const theirs = await seedMailbox(store, sibling, "Travel");
		const toMine = await storedFilter({ actionMailboxId: mine.mailboxId });
		const toTheirs = await storedFilter({ actionMailboxId: theirs.mailboxId });
		const tagOnly = await storedFilter({ actionLabelId: "label-1" });

		const listed = async (accountId: string) => {
			const outcome = await listAccountFilters(
				deps(),
				account.accountConfigId,
				accountId,
			);
			assert.ok(outcome.ok);
			return outcome.value.map((filter) => filter.filterId).sort();
		};

		assert.deepEqual(
			await listed(account.accountId),
			[toMine.filterId, tagOnly.filterId].sort(),
		);
		assert.deepEqual(
			await listed(sibling.accountId),
			[toTheirs.filterId, tagOnly.filterId].sort(),
		);
	});
});

describe("a filter that applies a label", () => {
	it("refuses a label id that names no label of the account", async () => {
		const folder = await seedMailbox(store, account, "Promoties");

		const outcome = await createFilter(
			deps(),
			{ accountConfigId: account.accountConfigId, userId: "user-1" },
			{
				accountId: account.accountId,
				filter: { ...rule("None"), actionLabelId: folder.mailboxId },
			},
		);

		assert.equal(refusalOf(outcome)?.kind, "Invalid");
		assert.deepEqual(
			await store.filter.listByAccountConfig(account.accountConfigId),
			[],
		);
	});
});

describe("a filter that applies a label with folders", () => {
	it("refuses a second move into a folder", async () => {
		const folder = await seedMailbox(store, account, "Receipts");
		const labelFolder = await seedMailbox(
			store,
			account,
			"INBOX/abcdq_remit/Bills",
		);
		const { labelId } = await store.label.create({
			accountConfigId: account.accountConfigId,
			name: "Bills",
		});
		await store.labelMailbox.put({
			labelId,
			accountId: account.accountId,
			mailboxId: labelFolder.mailboxId,
		});
		const owner = {
			accountConfigId: account.accountConfigId,
			userId: "user-1",
		};

		const both = await createFilter(deps(), owner, {
			accountId: account.accountId,
			filter: { ...rule(folder.mailboxId), actionLabelId: labelId },
		});
		assert.equal(refusalOf(both)?.kind, "Invalid");

		const labelOnly = await createFilter(deps(), owner, {
			accountId: account.accountId,
			filter: { ...rule("None"), actionLabelId: labelId },
		});
		assert.ok(labelOnly.ok);
		const patched = await updateFilter(deps(), account.accountConfigId, {
			accountId: account.accountId,
			filterId: labelOnly.value.filter.filterId,
			patch: { actionMailboxId: folder.mailboxId },
		});
		assert.equal(refusalOf(patched)?.kind, "Invalid");
	});
});
