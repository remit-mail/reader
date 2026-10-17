/**
 * One conversation held by two accounts is one thread (#1017).
 *
 * A thread used to be keyed on the account, so the same root header seen by two
 * connected mailboxes minted two threads: a reply sent from the second account
 * opened a conversation of one beside the conversation it answered, and the
 * reader showed the two halves as unrelated mail.
 *
 * The correspondent's message reaches the first account; the answer is sent
 * through reader from the second account, which files it in that account's
 * Sent. Both accounts belong to one user, which is the scope a thread is keyed
 * on now.
 *
 * A throwaway user, never the shared fixture: a second account there changes the
 * sidebar and the per-account counts the rest of the suite reads.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { listServerSubjects } from "../src/imap.js";
import {
	connectIsolatedAccount,
	type IsolatedAccount,
	type IsolatedRun,
	provisionIsolatedRun,
} from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const STAMP = Date.now();

/** Minted per run: a reused stack must not let one run's thread answer another's. */
const ROOT_MESSAGE_ID = `<cross-account-root-${STAMP}@remit.test>`;
const RECEIVED_SUBJECT = `Cross account thread root ${STAMP}`;
const REPLY_SUBJECT = `Re: ${RECEIVED_SUBJECT}`;
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

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(600_000);

		run = await provisionIsolatedRun("E2E Cross Account Thread First", [
			{
				subject: RECEIVED_SUBJECT,
				from: `Correspondent <${CORRESPONDENT}>`,
				messageIdHeader: ROOT_MESSAGE_ID,
			},
		]);
		api = new ApiClient(run);

		second = await connectIsolatedAccount(
			api,
			"E2E Cross Account Thread Second",
		);
		secondSentId = await mailboxIdForPath(api, second.accountId, "Sent");

		const context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
		});
		const page = await context.newPage();
		await api.messageIdForSubject(run.inboxId, RECEIVED_SUBJECT);
		await page.goto(`/mail/${run.inboxId}`);
		await page.getByText(RECEIVED_SUBJECT, { exact: true }).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
			timeout: 30_000,
		});
		await page.getByLabel("From:").selectOption({ label: second.imapUser });
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Answering from the second account.");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});
		await waitFor(
			() => listServerSubjects(second.imapUser, "Sent"),
			(subjects) => subjects.includes(REPLY_SUBJECT),
			{ timeoutMs: 120_000, what: "the answer to be filed in the second Sent" },
		);
		await context.close();
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
