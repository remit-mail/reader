/**
 * A superseded invitation opens the revision that replaced it (#1321).
 *
 * Two messages carry the same UID over IMAP, the second with a higher
 * SEQUENCE. The server retires the first card and names the conversation of
 * the second; the card's control is pressed in the UI, and what is asserted is
 * that the server's answer names the thread the second message lives in and
 * that the reading pane lands on it.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, type CalendarSuggestion, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type RunState, readRunState } from "../src/state.js";
import { MAILBOX_ROW_LINK, MAILBOX_THREAD_URL } from "../src/urls.js";

test.use({ viewport: { width: 1440, height: 900 } });

const TAG = `calendar-newer-revision ${Date.now()}`;
const SLUG = `revision-${Date.now()}`;
const UID = `${SLUG}@remit.test`;
const ORGANIZER = `organiser-${SLUG}@remit.test`;

interface Revision {
	sequence: number;
	subject: string;
	summary: string;
	hour: number;
}

const revisions: readonly [Revision, Revision] = [
	{
		sequence: 0,
		subject: `${TAG} first`,
		summary: `Revision e2e first ${Date.now()}`,
		hour: 9,
	},
	{
		sequence: 1,
		subject: `${TAG} moved`,
		summary: `Revision e2e moved ${Date.now()}`,
		hour: 14,
	},
];

const at = (hour: number): string =>
	`20270311T${String(hour).padStart(2, "0")}0000Z`;

const revisionMessage = (revision: Revision, recipient: string): string => {
	const vcalendar = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Remit e2e//Revision//EN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${UID}`,
		"DTSTAMP:20260901T090000Z",
		`SEQUENCE:${revision.sequence}`,
		`DTSTART:${at(revision.hour)}`,
		`DTEND:${at(revision.hour + 1)}`,
		`SUMMARY:${revision.summary}`,
		`ORGANIZER:mailto:${ORGANIZER}`,
		`ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${recipient}`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");
	return [
		`From: Organiser ${SLUG} <${ORGANIZER}>`,
		`To: ${recipient}`,
		`Subject: ${revision.subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${SLUG}.${revision.sequence}.msg@remit.test>`,
		"MIME-Version: 1.0",
		'Content-Type: multipart/alternative; boundary="remit-e2e-revision"',
		"",
		"--remit-e2e-revision",
		'Content-Type: text/plain; charset="utf-8"',
		"",
		`You are invited to ${revision.summary}.`,
		"--remit-e2e-revision",
		'Content-Type: text/calendar; method=REQUEST; charset="UTF-8"',
		"",
		vcalendar,
		"--remit-e2e-revision--",
		"",
	].join("\r\n");
};

const deliveredMessageIds: string[] = [];

const rail = (page: Page): Locator =>
	page.getByRole("complementary").filter({ hasText: "Intelligence" }).first();

const openRow = async (page: Page, run: RunState, subject: string) => {
	await page.goto(`/mail/${run.inboxId}`);
	const row = page.locator(MAILBOX_ROW_LINK).filter({ hasText: subject });
	await expect(async () => {
		await page.reload();
		await expect(row).toHaveCount(1, { timeout: 5_000 });
	}).toPass({ timeout: 90_000 });
	await row.click();
	await page.waitForURL(MAILBOX_THREAD_URL);
};

const deliver = async (
	page: Page,
	api: ApiClient,
	run: RunState,
	revision: Revision,
): Promise<string> => {
	await appendRawMessage(run.imapUser, revisionMessage(revision, run.imapUser));
	await api.triggerSync(run.accountId);
	const messageId = await api.messageIdForSubject(
		run.inboxId,
		revision.subject,
	);
	deliveredMessageIds.push(messageId);
	await openRow(page, run, revision.subject);
	await waitFor(
		() => api.listMessageCalendarSuggestions(messageId),
		(items) => items.length > 0,
		{
			timeoutMs: 90_000,
			what: `a suggestion read out of "${revision.subject}"`,
		},
	);
	return messageId;
};

test.afterAll(async () => {
	const run = readRunState();
	const api = new ApiClient(run);
	for (const messageId of deliveredMessageIds) {
		for (const suggestion of await api.listMessageCalendarSuggestions(
			messageId,
		)) {
			if (suggestion.state === "Pending")
				await api.dismissCalendarSuggestion(suggestion.suggestionId);
		}
	}
	for (const mailbox of await api.listMailboxes(run.accountId)) {
		const ids = await api.searchMatchingMessageIds(mailbox.mailboxId, TAG);
		if (ids.length > 0) await api.deleteMessages(ids);
	}
});

test("a superseded invitation opens the conversation of the revision that replaced it", async ({
	page,
	api,
	run,
}) => {
	const [first, moved] = revisions;
	const firstMessageId = await deliver(page, api, run, first);
	const movedMessageId = await deliver(page, api, run, moved);

	const retired = await waitFor(
		() => api.listMessageCalendarSuggestions(firstMessageId),
		(items) =>
			items.some(
				(item) =>
					item.state === "Superseded" && item.supersededByThreadId !== "",
			),
		{
			timeoutMs: 90_000,
			what: "the first revision to be retired by the second",
		},
	);
	const card = retired.find(
		(item): item is CalendarSuggestion => item.state === "Superseded",
	);
	const movedThread = (await api.listThreads(run.inboxId)).find(
		(thread) => thread.messageId === movedMessageId,
	);
	expect(movedThread, "the moved revision sits in a conversation").toBeTruthy();
	expect(card?.supersededByMessageId).toBe(movedMessageId);
	expect(card?.supersededByThreadId).toBe(movedThread?.threadId);

	await openRow(page, run, first.subject);
	const panel = rail(page);
	await expect(panel.getByText(/has sent a newer version of this/)).toBeVisible(
		{ timeout: 30_000 },
	);
	await panel
		.getByRole("button", { name: "Open the newer invitation", exact: true })
		.click();

	await page.waitForURL(
		new RegExp(`/${movedThread?.threadId}/${movedMessageId}(?:[?#]|$)`),
	);
	await expect(rail(page).getByText(moved.summary)).toBeVisible({
		timeout: 30_000,
	});
});
