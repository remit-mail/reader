/**
 * Regression cover for #46: a conversation showed the incoming half only, because
 * the thread was read one mailbox at a time and the user's own replies live in
 * Sent.
 *
 * Global setup put a two-turn conversation on the IMAP server — the
 * correspondent's message in INBOX, the reply to it in Sent, chained by
 * References — so what is asserted here is that the deployment reassembles them
 * into one conversation, over the API and in the browser.
 */

import type { ApiClient } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

/**
 * The thread the seeded conversation belongs to. Sync is asynchronous per
 * mailbox and Sent is synced after INBOX, so the inbox row can exist for a
 * while before its counterpart in Sent does — every read here is a poll.
 */
const conversationThreadId = async (
	api: ApiClient,
	inboxId: string,
	subject: string,
): Promise<string> => {
	const threads = await waitFor(
		() => api.listThreads(inboxId),
		(items) => items.some((thread) => thread.subject === subject),
		{ timeoutMs: 60_000, what: `the inbox row for "${subject}" to sync` },
	);
	const thread = threads.find((item) => item.subject === subject);
	if (!thread) throw new Error("unreachable: the thread was matched not found");
	return thread.threadId;
};

test.describe("A conversation spanning INBOX and Sent", () => {
	test.setTimeout(180_000);

	test("the thread carries both the received message and the sent reply", async ({
		api,
		run,
	}) => {
		const threadId = await conversationThreadId(
			api,
			run.inboxId,
			run.conversation.receivedSubject,
		);

		const messages = await waitFor(
			() => api.listThreadMessages(threadId),
			(items) =>
				items.some((item) => item.subject === run.conversation.sentSubject),
			{
				timeoutMs: 90_000,
				what: "the sent reply to join the thread",
			},
		);

		// Exactly the two turns, oldest first. The reply is a distinct message in
		// a distinct folder, so a thread of one — or of two copies of the same
		// message — is the failure this asserts against.
		expect(messages.map((message) => message.subject)).toEqual([
			run.conversation.receivedSubject,
			run.conversation.sentSubject,
		]);
		expect(new Set(messages.map((message) => message.mailboxId)).size).toBe(2);
	});

	test("opening it from the inbox shows both turns", async ({
		api,
		page,
		run,
	}) => {
		const threadId = await conversationThreadId(
			api,
			run.inboxId,
			run.conversation.receivedSubject,
		);
		await waitFor(
			() => api.listThreadMessages(threadId),
			(items) => items.length === 2,
			{ timeoutMs: 90_000, what: "both turns of the conversation to sync" },
		);

		await page.goto("/mail");
		const sidebar = page.getByRole("navigation", {
			name: "Mailboxes",
			exact: true,
		});
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await sidebar.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		await page
			.getByText(run.conversation.receivedSubject, { exact: true })
			.first()
			.click();
		await page.waitForURL(/selectedMessageId=/);

		const conversation = page.getByRole("article");
		await expect(conversation).toBeVisible({ timeout: 20_000 });

		// The count the header states is the count the reader believes it has, so
		// a conversation truncated to its inbox half fails here first.
		await expect(conversation.getByText("2 messages")).toBeVisible({
			timeout: 20_000,
		});

		// Both correspondents are on screen: the sender of the received message,
		// and the user themselves on the reply that only exists in Sent.
		await expect(
			conversation.getByText(run.conversation.receivedFromName).first(),
		).toBeVisible();
		await expect(
			conversation.getByText(run.conversation.sentFromName).first(),
		).toBeVisible();
	});
});
