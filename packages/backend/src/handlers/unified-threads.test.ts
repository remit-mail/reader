import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	AccountSettingItem,
	MailboxItem,
} from "@remit/remit-electrodb-service";
import {
	attachAccountIds,
	buildInboxMailboxMap,
	buildListAllThreadsOptions,
	type InboxMapClient,
} from "./unified-threads.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeAccount = (accountId: string, accountConfigId: string): AccountItem =>
	({
		accountId,
		accountConfigId,
	}) as unknown as AccountItem;

const makeMailbox = (
	mailboxId: string,
	accountId: string,
	fullPath: string,
): MailboxItem =>
	({
		mailboxId,
		accountId,
		fullPath,
	}) as unknown as MailboxItem;

// Mute flags live in per-target AccountSetting rows (RFC 032). These build the
// composite-named rows the client returns from listByAccountConfig.
const mutedAccountSetting = (accountId: string): AccountSettingItem =>
	({
		name: `AccountMuted#${accountId}`,
		value: { kind: "MutedFlag", value: { value: true, setAt: 1 } },
	}) as unknown as AccountSettingItem;

const mutedMailboxSetting = (mailboxId: string): AccountSettingItem =>
	({
		name: `MailboxMuted#${mailboxId}`,
		value: { kind: "MutedFlag", value: { value: true, setAt: 1 } },
	}) as unknown as AccountSettingItem;

const makeClient = (
	accounts: AccountItem[],
	mailboxesByAccount: Record<string, MailboxItem[]>,
	settings: AccountSettingItem[] = [],
): InboxMapClient => ({
	account: {
		listAllByAccountConfig: async (_accountConfigId) => accounts,
	},
	mailbox: {
		listAllByAccount: async (accountId: string) =>
			mailboxesByAccount[accountId] ?? [],
	},
	accountSetting: {
		listByAccountConfig: async (_accountConfigId) => settings,
	},
});

// ---------------------------------------------------------------------------
// buildInboxMailboxMap
// ---------------------------------------------------------------------------

describe("buildInboxMailboxMap (#432)", () => {
	it("maps INBOX mailboxId → accountId for a single account", async () => {
		const account = makeAccount("acc-1", "cfg-1");
		const inbox = makeMailbox("mb-inbox-1", "acc-1", "INBOX");
		const sent = makeMailbox("mb-sent-1", "acc-1", "Sent");

		const client = makeClient([account], { "acc-1": [inbox, sent] });
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(mailboxIdToAccountId.get("mb-inbox-1"), "acc-1");
		assert.equal(mailboxIdToAccountId.has("mb-sent-1"), false);
		assert.ok(inboxMailboxIds.has("mb-inbox-1"));
		assert.equal(inboxMailboxIds.has("mb-sent-1"), false);
	});

	it("collects INBOX mailboxes from two accounts", async () => {
		const acc1 = makeAccount("acc-1", "cfg-1");
		const acc2 = makeAccount("acc-2", "cfg-1");
		const inbox1 = makeMailbox("mb-inbox-1", "acc-1", "INBOX");
		const inbox2 = makeMailbox("mb-inbox-2", "acc-2", "INBOX");

		const client = makeClient([acc1, acc2], {
			"acc-1": [inbox1],
			"acc-2": [inbox2],
		});
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(mailboxIdToAccountId.get("mb-inbox-1"), "acc-1");
		assert.equal(mailboxIdToAccountId.get("mb-inbox-2"), "acc-2");
		assert.equal(inboxMailboxIds.size, 2);
	});

	it("excludes accounts muted via an AccountMuted setting", async () => {
		const mutedAccount = makeAccount("acc-muted", "cfg-1");
		const inbox = makeMailbox("mb-inbox-muted", "acc-muted", "INBOX");

		const client = makeClient([mutedAccount], { "acc-muted": [inbox] }, [
			mutedAccountSetting("acc-muted"),
		]);
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(inboxMailboxIds.size, 0);
		assert.equal(mailboxIdToAccountId.size, 0);
	});

	it("excludes mailboxes muted via a MailboxMuted setting even when account is not muted", async () => {
		const account = makeAccount("acc-1", "cfg-1");
		const mutedInbox = makeMailbox("mb-inbox-muted", "acc-1", "INBOX");

		const client = makeClient([account], { "acc-1": [mutedInbox] }, [
			mutedMailboxSetting("mb-inbox-muted"),
		]);
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(inboxMailboxIds.size, 0);
		assert.equal(mailboxIdToAccountId.size, 0);
	});

	it("includes account with only non-muted INBOX even when other accounts are muted", async () => {
		const active = makeAccount("acc-active", "cfg-1");
		const muted = makeAccount("acc-muted", "cfg-1");
		const inbox = makeMailbox("mb-inbox-active", "acc-active", "INBOX");
		const mutedInbox = makeMailbox("mb-inbox-muted", "acc-muted", "INBOX");

		const client = makeClient(
			[active, muted],
			{
				"acc-active": [inbox],
				"acc-muted": [mutedInbox],
			},
			[mutedAccountSetting("acc-muted")],
		);
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(inboxMailboxIds.size, 1);
		assert.ok(inboxMailboxIds.has("mb-inbox-active"));
		assert.equal(mailboxIdToAccountId.get("mb-inbox-active"), "acc-active");
	});

	it("returns empty maps when no accounts exist", async () => {
		const client = makeClient([], {});
		const { mailboxIdToAccountId, inboxMailboxIds } =
			await buildInboxMailboxMap("cfg-1", client);

		assert.equal(inboxMailboxIds.size, 0);
		assert.equal(mailboxIdToAccountId.size, 0);
	});

	it("ignores non-INBOX mailboxes (Sent, Drafts, etc.)", async () => {
		const account = makeAccount("acc-1", "cfg-1");
		const mailboxes = [
			makeMailbox("mb-sent", "acc-1", "Sent"),
			makeMailbox("mb-drafts", "acc-1", "Drafts"),
			makeMailbox("mb-trash", "acc-1", "Trash"),
			makeMailbox("mb-archive", "acc-1", "[Gmail]/All Mail"),
		];

		const client = makeClient([account], { "acc-1": mailboxes });
		const { inboxMailboxIds } = await buildInboxMailboxMap("cfg-1", client);

		assert.equal(inboxMailboxIds.size, 0);
	});

	it("INBOX detection is case-insensitive", async () => {
		const account = makeAccount("acc-1", "cfg-1");
		const inbox = makeMailbox("mb-inbox-1", "acc-1", "inbox");

		const client = makeClient([account], { "acc-1": [inbox] });
		const { inboxMailboxIds } = await buildInboxMailboxMap("cfg-1", client);

		assert.ok(inboxMailboxIds.has("mb-inbox-1"));
	});
});

// ---------------------------------------------------------------------------
// buildListAllThreadsOptions
// ---------------------------------------------------------------------------

describe("buildListAllThreadsOptions (#432)", () => {
	const inboxIds = new Set(["mb-inbox-1"]);

	it("forces excludeDeleted: true always", () => {
		const opts = buildListAllThreadsOptions({}, inboxIds);
		assert.equal(opts.excludeDeleted, true);
	});

	it("defaults order to 'desc'", () => {
		const opts = buildListAllThreadsOptions({}, inboxIds);
		assert.equal(opts.order, "desc");
	});

	it("respects explicit order parameter", () => {
		const opts = buildListAllThreadsOptions({ order: "asc" }, inboxIds);
		assert.equal(opts.order, "asc");
	});

	it("forwards continuationToken", () => {
		const opts = buildListAllThreadsOptions(
			{ continuationToken: "tok-abc" },
			inboxIds,
		);
		assert.equal(opts.continuationToken, "tok-abc");
	});

	it("applies a default page size when limit is absent", () => {
		const opts = buildListAllThreadsOptions({}, inboxIds);
		assert.ok(
			typeof opts.limit === "number" && opts.limit > 0,
			"limit must be a positive number",
		);
	});

	it("respects explicit limit", () => {
		const opts = buildListAllThreadsOptions({ limit: 10 }, inboxIds);
		assert.equal(opts.limit, 10);
	});

	it("passes inboxMailboxIds through", () => {
		const ids = new Set(["mb-a", "mb-b"]);
		const opts = buildListAllThreadsOptions({}, ids);
		assert.strictEqual(opts.inboxMailboxIds, ids);
	});
});

// ---------------------------------------------------------------------------
// attachAccountIds
// ---------------------------------------------------------------------------

describe("attachAccountIds (#432)", () => {
	const makeRow = (mailboxId: string) =>
		({
			threadMessageId: `tm-${mailboxId}`,
			mailboxId,
			senderTrust: "unknown",
		}) as Awaited<
			ReturnType<
				typeof import("../derive/enrichThreadRows.js").enrichThreadRows
			>
		>[number];

	it("attaches accountId from mailboxId→accountId map", () => {
		const map = new Map([["mb-inbox-1", "acc-1"]]);
		const rows = [makeRow("mb-inbox-1")];
		const enriched = attachAccountIds(rows, map);

		assert.equal(enriched[0].accountId, "acc-1");
	});

	it("attaches accountId for rows from different accounts", () => {
		const map = new Map([
			["mb-inbox-1", "acc-1"],
			["mb-inbox-2", "acc-2"],
		]);
		const rows = [makeRow("mb-inbox-1"), makeRow("mb-inbox-2")];
		const enriched = attachAccountIds(rows, map);

		assert.equal(enriched[0].accountId, "acc-1");
		assert.equal(enriched[1].accountId, "acc-2");
	});

	it("leaves accountId undefined when mailboxId is not in the map", () => {
		const map = new Map<string, string>();
		const rows = [makeRow("mb-unknown")];
		const enriched = attachAccountIds(rows, map);

		assert.equal(enriched[0].accountId, undefined);
	});

	it("does not mutate original rows", () => {
		const map = new Map([["mb-inbox-1", "acc-1"]]);
		const row = makeRow("mb-inbox-1");
		const [enriched] = attachAccountIds([row], map);

		assert.notStrictEqual(enriched, row);
	});
});
