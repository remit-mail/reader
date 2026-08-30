/**
 * One conversation held by two accounts is one thread (#1017).
 *
 * A thread used to be keyed on the account, so the same root header seen by two
 * connected mailboxes minted two threads: a reply sent from the second account
 * opened a conversation of one beside the conversation it answered, and the
 * reader showed the two halves as unrelated mail.
 *
 * The fixture is the cross-folder conversation of `thread-sent-messages.spec.ts`
 * split across accounts: the correspondent's message in the first account's
 * INBOX, the answer to it in the second account's Sent, References-chained. Both
 * accounts belong to one user, which is the scope a thread is keyed on now.
 *
 * A throwaway user, never the shared fixture: a second account there changes the
 * sidebar and the per-account counts the rest of the suite reads.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import {
	connectIsolatedAccount,
	type IsolatedAccount,
	type IsolatedRun,
	provisionIsolatedRun,
} from "../src/provision.js";

const STAMP = Date.now();

/** Minted per run: a reused stack must not let one run's thread answer another's. */
const ROOT_MESSAGE_ID = `<cross-account-root-${STAMP}@remit.test>`;
const RECEIVED_SUBJECT = `Cross account thread root ${STAMP}`;
const REPLY_SUBJECT = `Cross account thread reply ${STAMP}`;
const CORRESPONDENT = "correspondent@remit.test";

/**
 * The thread carrying one subject in a mailbox. Sync is asynchronous per
 * mailbox, so every read here is a poll.
 */
const threadIdForSubject = async (
	api: ApiClient,
	mailboxId: string,
	subject: string,
): Promise<string> => {
	const threads = await waitFor(
		() => api.listThreads(mailboxId),
		(items) => items.some((thread) => thread.subject === subject),
		{ timeoutMs: 90_000, what: `the row for "${subject}" to sync` },
	);
	const match = threads.find((thread) => thread.subject === subject);
	if (!match)
		throw new Error("unreachable: the thread was matched but not found");
	return match.threadId;
};

const mailboxIdForPath = async (
	api: ApiClient,
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const boxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((box) => box.fullPath === fullPath),
		{ timeoutMs: 90_000, what: `the ${fullPath} folder to sync` },
	);
	const box = boxes.find((item) => item.fullPath === fullPath);
	if (!box)
		throw new Error("unreachable: the mailbox was matched but not found");
	return box.mailboxId;
};

test.describe("A conversation spanning two accounts", () => {
	let run: IsolatedRun;
	let second: IsolatedAccount;
	let api: ApiClient;
	let secondSentId: string;

	test.beforeAll(async () => {
		test.setTimeout(600_000);

		const receivedAt = new Date();
		run = await provisionIsolatedRun("E2E Cross Account Thread First", [
			{
				subject: RECEIVED_SUBJECT,
				from: `Correspondent <${CORRESPONDENT}>`,
				messageIdHeader: ROOT_MESSAGE_ID,
				date: receivedAt,
			},
		]);
		api = new ApiClient(run);

		second = await connectIsolatedAccount(
			api,
			"E2E Cross Account Thread Second",
		);
		secondSentId = await mailboxIdForPath(api, second.accountId, "Sent");

		// The answer, as the second account's own Sent copy. Dated after the
		// message it answers, so the conversation has an order to get right.
		await appendMessages(
			second.imapUser,
			[
				{
					subject: REPLY_SUBJECT,
					from: `Second Identity <${second.imapUser}>`,
					to: CORRESPONDENT,
					messageIdHeader: `<cross-account-reply-${STAMP}@remit.test>`,
					inReplyTo: ROOT_MESSAGE_ID,
					references: [ROOT_MESSAGE_ID],
					date: new Date(receivedAt.getTime() + 60_000),
				},
			],
			"Sent",
		);
		await api.triggerSync(second.accountId);
	});

	test("the reply from the second account carries the thread of the first account's message", async () => {
		test.setTimeout(300_000);

		const rootThreadId = await threadIdForSubject(
			api,
			run.inboxId,
			RECEIVED_SUBJECT,
		);
		const replyThreadId = await threadIdForSubject(
			api,
			secondSentId,
			REPLY_SUBJECT,
		);

		expect(replyThreadId).toBe(rootThreadId);
	});

	test("the conversation reads back as one thread holding both accounts' copies", async () => {
		test.setTimeout(300_000);

		const threadId = await threadIdForSubject(
			api,
			run.inboxId,
			RECEIVED_SUBJECT,
		);
		const messages = await waitFor(
			() => api.listThreadMessages(threadId),
			(items) => items.some((item) => item.subject === REPLY_SUBJECT),
			{
				timeoutMs: 90_000,
				what: "the second account's reply to join the thread",
			},
		);

		// Exactly the two turns, oldest first. A thread of one is the split this
		// asserts against; the two mailboxes are the two accounts.
		expect(messages.map((message) => message.subject)).toEqual([
			RECEIVED_SUBJECT,
			REPLY_SUBJECT,
		]);
		expect(new Set(messages.map((message) => message.mailboxId)).size).toBe(2);
	});
});
