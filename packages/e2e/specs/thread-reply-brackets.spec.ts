/**
 * A reply from reader names its parent with one pair of brackets, and lands in
 * the parent's thread.
 *
 * The composer handed over the parent's Message-ID as the envelope holds it,
 * brackets included, and the builder wrapped it again: every reply went out as
 * `In-Reply-To: <<id>>`. Sync keyed the thread on that spelling, so the reply
 * opened a conversation of its own, and a correspondent whose client copied the
 * References carried later mail into the split thread too. The headers are read
 * off the Sent copy the server holds, and the threads off the read model.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, serverRawSourceForSubject } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const DESKTOP = { width: 1512, height: 864 };
const STAMP = Date.now();
const CORRESPONDENT = "correspondent@remit.test";

const ROOT_ID = `<brackets-root-${STAMP}@remit.test>`;
const ROOT_SUBJECT = `Brackets root ${STAMP}`;
const PARENT_ID = `<brackets-parent-${STAMP}@remit.test>`;
/** The message the parent answers, held by nobody here: the parent is a thread of its own. */
const ELSEWHERE_ID = `<brackets-elsewhere-${STAMP}@remit.test>`;
const PARENT_SUBJECT = `Brackets parent ${STAMP}`;
const ANSWER_SUBJECT = `Brackets answer ${STAMP}`;

/** One header's value, unfolded, from raw RFC 5322 source. */
const headerOf = (raw: string, name: string): string | undefined => {
	const head = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
	const prefix = `${name.toLowerCase()}:`;
	const line = head
		.split(/\r?\n/)
		.find((candidate) => candidate.toLowerCase().startsWith(prefix));
	return line?.slice(prefix.length).trim();
};

const threadIdForSubject = async (
	api: ApiClient,
	run: IsolatedRun,
	mailboxId: string,
	subject: string,
): Promise<string> => {
	const threads = await waitFor(
		async () => {
			await api.triggerSync(run.accountId);
			return api.listThreads(mailboxId);
		},
		(items) => items.some((thread) => thread.subject === subject),
		{
			timeoutMs: 120_000,
			intervalMs: 5_000,
			what: `the row for "${subject}" to sync`,
		},
	);
	const match = threads.find((thread) => thread.subject === subject);
	if (!match) throw new Error("unreachable: matched but not found");
	return match.threadId;
};

test.describe("A reply sent from reader", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;
	let sentId: string;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		const receivedAt = Date.now();
		run = await provisionIsolatedRun("E2E Reply Brackets", [
			{
				subject: ROOT_SUBJECT,
				from: `Correspondent <${CORRESPONDENT}>`,
				messageIdHeader: ROOT_ID,
				date: new Date(receivedAt - 120_000),
			},
			{
				subject: PARENT_SUBJECT,
				from: `Correspondent <${CORRESPONDENT}>`,
				messageIdHeader: PARENT_ID,
				inReplyTo: ELSEWHERE_ID,
				references: [ELSEWHERE_ID],
				date: new Date(receivedAt - 60_000),
			},
		]);
		api = new ApiClient(run);

		const boxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
		const sent = boxes.find((box) => box.fullPath === "Sent");
		if (!sent) throw new Error("unreachable: the Sent folder was matched");
		sentId = sent.mailboxId;

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	const replyTo = async (page: Page, subject: string): Promise<string> => {
		await api.messageIdForSubject(run.inboxId, subject);
		await page.goto(`/mail/${run.inboxId}`);
		await page.getByText(subject, { exact: true }).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(page.getByRole("article").first()).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
			timeout: 30_000,
		});
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Answering in the same conversation.");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const replySubject = `Re: ${subject}`;
		const filed = await waitFor(
			() => serverRawSourceForSubject(run.imapUser, "Sent", replySubject),
			(source) => source !== null,
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		if (filed === null) throw new Error("unreachable: the Sent copy matched");
		return filed;
	};

	test("a reply to a reply names its parent with one pair of brackets", async () => {
		test.setTimeout(300_000);
		const page = await context.newPage();

		const filed = await replyTo(page, PARENT_SUBJECT);

		expect(headerOf(filed, "In-Reply-To")).toBe(PARENT_ID);
		const references = (headerOf(filed, "References") ?? "").split(/\s+/);
		expect(references).toContain(PARENT_ID);
		for (const reference of references) {
			expect(reference).toMatch(/^<[^<>]+>$/);
		}
	});

	test("a reply lands in the thread of the message it answers", async () => {
		test.setTimeout(300_000);
		const page = await context.newPage();

		const filed = await replyTo(page, ROOT_SUBJECT);
		expect(headerOf(filed, "In-Reply-To")).toBe(ROOT_ID);

		const rootThreadId = await threadIdForSubject(
			api,
			run,
			run.inboxId,
			ROOT_SUBJECT,
		);
		const replyThreadId = await threadIdForSubject(
			api,
			run,
			sentId,
			`Re: ${ROOT_SUBJECT}`,
		);
		expect(replyThreadId).toBe(rootThreadId);
	});

	test("an answer that doubled its parent's brackets still joins the parent's thread", async () => {
		test.setTimeout(300_000);
		// What a correspondent's client sends back after copying one of the
		// doubled replies reader used to send.
		await appendMessages(run.imapUser, [
			{
				subject: ANSWER_SUBJECT,
				from: `Correspondent <${CORRESPONDENT}>`,
				messageIdHeader: `<brackets-answer-${STAMP}@remit.test>`,
				inReplyTo: `<${ROOT_ID}>`,
				references: [`<${ROOT_ID}>`],
			},
		]);

		const rootThreadId = await threadIdForSubject(
			api,
			run,
			run.inboxId,
			ROOT_SUBJECT,
		);
		const answerThreadId = await threadIdForSubject(
			api,
			run,
			run.inboxId,
			ANSWER_SUBJECT,
		);
		expect(answerThreadId).toBe(rootThreadId);
	});
});
