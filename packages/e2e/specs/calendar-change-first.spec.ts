import type { Page } from "@playwright/test";
import { ApiClient, type CalendarSuggestion, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type RunState, readRunState } from "../src/state.js";
import { MAILBOX_ROW_LINK, MAILBOX_THREAD_URL } from "../src/urls.js";

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC" });

const TAG = `calendar-change-first ${Date.now()}`;
const DAY = "2027-04-14";
const WINDOW = {
	from: "2027-04-13T00:00:00+00:00",
	to: "2027-04-16T00:00:00+00:00",
};

interface Invitation {
	subject: string;
	summary: string;
	organizer: string;
	uid: string;
}

const invitation = (name: string): Invitation => {
	const slug = `change-first-${name}-${Date.now()}`;
	return {
		subject: `${TAG} ${name}`,
		summary: `Change first e2e ${name} ${Date.now()}`,
		organizer: `organiser-${slug}@remit.test`,
		uid: `${slug}@remit.test`,
	};
};

const unresolvableInvitation = (
	invite: Invitation,
	hour: number,
	recipient: string,
): string => {
	const at = (h: number) =>
		`${DAY.replaceAll("-", "")}T${String(h).padStart(2, "0")}0000`;
	const vcalendar = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Remit e2e//Invitation//EN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${invite.uid}`,
		"DTSTAMP:20260901T090000Z",
		"SEQUENCE:0",
		`DTSTART;TZID=Nowhere Standard Time:${at(hour)}`,
		`DTEND;TZID=Nowhere Standard Time:${at(hour + 1)}`,
		`SUMMARY:${invite.summary}`,
		`ORGANIZER:mailto:${invite.organizer}`,
		`ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${recipient}`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");
	return [
		`From: Organiser <${invite.organizer}>`,
		`To: ${recipient}`,
		`Subject: ${invite.subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${invite.uid.replace("@", ".msg@")}>`,
		"MIME-Version: 1.0",
		'Content-Type: multipart/alternative; boundary="remit-e2e-invite"',
		"",
		"--remit-e2e-invite",
		'Content-Type: text/plain; charset="utf-8"',
		"",
		`You are invited to ${invite.summary}.`,
		"--remit-e2e-invite",
		'Content-Type: text/calendar; method=REQUEST; charset="UTF-8"',
		"",
		vcalendar,
		"--remit-e2e-invite--",
		"",
	].join("\r\n");
};

const deliver = async (
	page: Page,
	api: ApiClient,
	run: RunState,
	invite: Invitation,
	hour: number,
): Promise<CalendarSuggestion> => {
	await appendRawMessage(
		run.imapUser,
		unresolvableInvitation(invite, hour, run.imapUser),
	);
	await api.triggerSync(run.accountId);
	const messageId = await api.messageIdForSubject(run.inboxId, invite.subject);
	deliveredMessages.push(messageId);

	await page.goto(`/mail/${run.inboxId}`);
	const row = page
		.locator(MAILBOX_ROW_LINK)
		.filter({ hasText: invite.subject });
	await expect(async () => {
		await page.reload();
		await expect(row).toHaveCount(1, { timeout: 5_000 });
	}).toPass({ timeout: 90_000 });
	await row.click();
	await page.waitForURL(MAILBOX_THREAD_URL);

	const suggestions = await waitFor(
		() => api.listMessageCalendarSuggestions(messageId),
		(items) => items.some((item) => item.state === "Pending"),
		{ timeoutMs: 90_000, what: `a suggestion read out of "${invite.subject}"` },
	);
	const pending = suggestions.find((item) => item.state === "Pending");
	if (!pending) throw new Error("unreachable: matched but not found");
	expect(pending.summary).toBe(invite.summary);
	return pending;
};

const openWaitingCard = async (page: Page, invite: Invitation) => {
	await page.goto(`/calendar/week/${DAY}`);
	const card = page
		.getByRole("complementary", { name: "Waiting for you" })
		.getByRole("article", { name: invite.summary });
	await expect(card).toBeVisible({ timeout: 30_000 });
	return card;
};

const settledOnServer = async (
	api: ApiClient,
	pending: CalendarSuggestion,
): Promise<CalendarSuggestion> => {
	const settled = await waitFor(
		() => api.listMessageCalendarSuggestions(pending.messageId),
		(items) =>
			items.some(
				(item) =>
					item.suggestionId === pending.suggestionId &&
					item.state === "Accepted",
			),
		{ what: "the suggestion to be Accepted on the server" },
	);
	const accepted = settled.find(
		(item) => item.suggestionId === pending.suggestionId,
	);
	if (!accepted) throw new Error("unreachable: matched but not found");
	expect(accepted.acceptedCalendarObjectId).not.toBe("");
	return accepted;
};

const createdObjects: { calendarObjectId: string; calendarId: string }[] = [];
const deliveredMessages: string[] = [];

const servedAs = async (api: ApiClient, summary: string) => {
	const events = await waitFor(
		() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
		(items) => items.some((item) => item.summary === summary),
		{ what: `"${summary}" to be on the calendar` },
	);
	const stored = events.find((item) => item.summary === summary);
	if (!stored) throw new Error("unreachable: matched but not found");
	createdObjects.push({
		calendarObjectId: stored.calendarObjectId,
		calendarId: stored.calendarId,
	});
	return { stored, events };
};

test.afterAll(async () => {
	const run = readRunState();
	const api = new ApiClient(run);
	for (const created of createdObjects)
		await api.deleteCalendarEvent(created.calendarObjectId, created.calendarId);
	for (const messageId of deliveredMessages) {
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

test.describe("Changing a suggestion before adding it", () => {
	test.describe.configure({ mode: "serial" });

	test("writes the corrected event and settles the suggestion on the server", async ({
		page,
		api,
		run,
	}) => {
		test.setTimeout(180_000);
		const invite = invitation("change");
		const corrected = `${invite.summary} corrected`;
		const pending = await deliver(page, api, run, invite, 9);

		const card = await openWaitingCard(page, invite);
		await card.getByRole("button", { name: "Change first" }).click();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toHaveValue(invite.summary, { timeout: 30_000 });
		await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
			"09:00",
		);
		await expect(
			page.getByText(/named a time zone nothing could resolve/),
		).toBeVisible();

		await title.fill(corrected);
		await page.getByLabel("Start time", { exact: true }).fill("13:00");
		await page.getByLabel("End time", { exact: true }).fill("14:30");
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const accepted = await settledOnServer(api, pending);
		const { stored, events } = await servedAs(api, corrected);
		expect(stored.calendarObjectId).toBe(accepted.acceptedCalendarObjectId);
		expect(new Date(stored.start).toISOString()).toBe(`${DAY}T13:00:00.000Z`);
		expect(new Date(stored.end).toISOString()).toBe(`${DAY}T14:30:00.000Z`);
		expect(events.map((item) => item.summary)).not.toContain(invite.summary);
	});

	test("Add on a time nobody could place opens the editor, and saving it settles the suggestion", async ({
		page,
		api,
		run,
	}) => {
		test.setTimeout(180_000);
		const invite = invitation("add");
		const pending = await deliver(page, api, run, invite, 15);

		const card = await openWaitingCard(page, invite);
		await card
			.getByRole("button", { name: "Add to calendar", exact: true })
			.click();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toHaveValue(invite.summary, { timeout: 30_000 });
		await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
			"15:00",
		);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const accepted = await settledOnServer(api, pending);
		const { stored } = await servedAs(api, invite.summary);
		expect(stored.calendarObjectId).toBe(accepted.acceptedCalendarObjectId);
		expect(new Date(stored.start).toISOString()).toBe(`${DAY}T15:00:00.000Z`);
		expect(new Date(stored.end).toISOString()).toBe(`${DAY}T16:00:00.000Z`);
	});
});
