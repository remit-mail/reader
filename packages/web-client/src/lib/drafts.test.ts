import assert from "node:assert";
import { describe, test } from "node:test";
import type {
	RemitImapOutboxMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { groupDraftSections } from "./drafts.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function outboxMessage(
	overrides: Partial<RemitImapOutboxMessageResponse> &
		Pick<RemitImapOutboxMessageResponse, "outboxMessageId" | "accountId">,
): RemitImapOutboxMessageResponse {
	return {
		fromAddress: "me@example.com",
		toAddresses: ["alice@example.com"],
		status: "draft",
		createdAt: 1_000_000,
		updatedAt: 1_000_000,
		...overrides,
	} as RemitImapOutboxMessageResponse;
}

function threadMessage(
	overrides: Partial<RemitImapThreadMessageResponse> &
		Pick<
			RemitImapThreadMessageResponse,
			"threadMessageId" | "threadId" | "messageId" | "accountConfigId"
		>,
): RemitImapThreadMessageResponse {
	return {
		mailboxId: "mb-drafts",
		sentDate: 1_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		...overrides,
	} as RemitImapThreadMessageResponse;
}

// ---------------------------------------------------------------------------
// groupDraftSections
// ---------------------------------------------------------------------------

describe("groupDraftSections", () => {
	test("returns empty array when both sources are empty", () => {
		const sections = groupDraftSections({
			outboxMessages: [],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.deepStrictEqual(sections, []);
	});

	test("returns only Remit-drafts section when there are no IMAP threads", () => {
		const draft = outboxMessage({
			outboxMessageId: "d1",
			accountId: "acc-1",
			status: "draft",
		});
		const sections = groupDraftSections({
			outboxMessages: [draft],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "remit-drafts");
		assert.strictEqual(sections[0].threads.length, 1);
		assert.strictEqual(sections[0].threads[0].id, "d1");
	});

	test("returns only IMAP-drafts section when there are no Remit drafts", () => {
		const thread = threadMessage({
			threadMessageId: "tm1",
			threadId: "t1",
			messageId: "m1",
			accountConfigId: "acc-1",
		});
		const sections = groupDraftSections({
			outboxMessages: [],
			accountId: "acc-1",
			imapThreads: [thread],
		});
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "imap-drafts");
		assert.strictEqual(sections[0].threads.length, 1);
		assert.strictEqual(sections[0].threads[0].id, "m1");
	});

	test("returns both sections when both sources have rows", () => {
		const draft = outboxMessage({
			outboxMessageId: "d1",
			accountId: "acc-1",
			status: "draft",
		});
		const thread = threadMessage({
			threadMessageId: "tm1",
			threadId: "t1",
			messageId: "m1",
			accountConfigId: "acc-1",
		});
		const sections = groupDraftSections({
			outboxMessages: [draft],
			accountId: "acc-1",
			imapThreads: [thread],
		});
		assert.strictEqual(sections.length, 2);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["remit-drafts", "imap-drafts"],
		);
	});

	test("per-account filter: only drafts for the given accountId appear", () => {
		const draftOwner = outboxMessage({
			outboxMessageId: "d1",
			accountId: "acc-1",
			status: "draft",
		});
		const draftOther = outboxMessage({
			outboxMessageId: "d2",
			accountId: "acc-2",
			status: "draft",
		});
		const sections = groupDraftSections({
			outboxMessages: [draftOwner, draftOther],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].threads.length, 1);
		assert.strictEqual(sections[0].threads[0].id, "d1");
	});

	test("status filter: non-draft statuses are excluded from Remit section", () => {
		const draft = outboxMessage({
			outboxMessageId: "d1",
			accountId: "acc-1",
			status: "draft",
		});
		const queued = outboxMessage({
			outboxMessageId: "q1",
			accountId: "acc-1",
			status: "queued",
		});
		const failed = outboxMessage({
			outboxMessageId: "f1",
			accountId: "acc-1",
			status: "failed",
		});
		const blocked = outboxMessage({
			outboxMessageId: "b1",
			accountId: "acc-1",
			status: "blocked",
		});
		const sending = outboxMessage({
			outboxMessageId: "s1",
			accountId: "acc-1",
			status: "sending",
		});
		const sections = groupDraftSections({
			outboxMessages: [draft, queued, failed, blocked, sending],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.strictEqual(sections.length, 1);
		// Only the draft should appear
		assert.strictEqual(sections[0].threads.length, 1);
		assert.strictEqual(sections[0].threads[0].id, "d1");
	});

	test("empty sections are omitted when status filter removes all drafts", () => {
		const queued = outboxMessage({
			outboxMessageId: "q1",
			accountId: "acc-1",
			status: "queued",
		});
		const sections = groupDraftSections({
			outboxMessages: [queued],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.deepStrictEqual(sections, []);
	});

	test("section labels match spec", () => {
		const draft = outboxMessage({
			outboxMessageId: "d1",
			accountId: "acc-1",
			status: "draft",
		});
		const thread = threadMessage({
			threadMessageId: "tm1",
			threadId: "t1",
			messageId: "m1",
			accountConfigId: "acc-1",
		});
		const sections = groupDraftSections({
			outboxMessages: [draft],
			accountId: "acc-1",
			imapThreads: [thread],
		});
		assert.deepStrictEqual(
			sections.map((s) => s.label),
			["Not yet sent (Remit)", "On the server"],
		);
	});

	test("Remit-drafts section row id equals outboxMessageId", () => {
		const draft = outboxMessage({
			outboxMessageId: "outbox-abc",
			accountId: "acc-1",
			status: "draft",
		});
		const sections = groupDraftSections({
			outboxMessages: [draft],
			accountId: "acc-1",
			imapThreads: [],
		});
		assert.strictEqual(sections[0].threads[0].id, "outbox-abc");
	});

	test("IMAP-drafts section row id equals messageId", () => {
		const thread = threadMessage({
			threadMessageId: "tm1",
			threadId: "t1",
			messageId: "msg-xyz",
			accountConfigId: "acc-1",
		});
		const sections = groupDraftSections({
			outboxMessages: [],
			accountId: "acc-1",
			imapThreads: [thread],
		});
		assert.strictEqual(sections[0].threads[0].id, "msg-xyz");
	});
});
