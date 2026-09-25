/**
 * An invitation in the mail, answered beside the message (#1277, stage B.1 of
 * #1033).
 *
 * Each case APPENDs a real iCalendar invitation to the run's inbox, the way an
 * organiser's mail client would deliver it, and waits for the server to read a
 * suggestion out of it. The answer is given in the UI; what is asserted is what
 * the server then holds — the suggestion's state, the event accepting wrote,
 * the sender rule muting wrote. A card that redraws itself from its own cache
 * passes a pixel check and stores nothing, which is the failure this catches.
 *
 * Every fixture is scratch: the serial suite asserts the inbox holds exactly
 * `seededSubjects`, so the messages, the event and the rule are all removed on
 * the way out.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, type CalendarSuggestion, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type RunState, readRunState } from "../src/state.js";
import { MAILBOX_ROW_LINK, MAILBOX_THREAD_URL } from "../src/urls.js";

test.use({ viewport: { width: 1440, height: 900 } });

const TAG = `calendar-invitation ${Date.now()}`;

/**
 * A fixed day no other spec writes to, far enough out that the day's busy time
 * is the invitation's own business. The window reads it back.
 */
const DAY = "2027-03-10";
const WINDOW = {
	from: "2027-03-09T00:00:00+00:00",
	to: "2027-03-12T00:00:00+00:00",
};

interface Invitation {
	subject: string;
	summary: string;
	sender: string;
	uid: string;
}

const invitation = (name: string): Invitation => {
	const slug = `${name}-${Date.now()}`;
	return {
		subject: `${TAG} ${name}`,
		summary: `Invitation e2e ${name} ${Date.now()}`,
		sender: `organiser-${slug}@remit.test`,
		uid: `${slug}@remit.test`,
	};
};

const at = (hour: number): string =>
	`${DAY.replaceAll("-", "")}T${String(hour).padStart(2, "0")}0000Z`;

/**
 * An invitation as Outlook and Google send one: a `multipart/alternative`
 * whose second leg is `text/calendar; method=REQUEST`, and the organiser is
 * the sender.
 */
const invitationMessage = (
	invite: Invitation,
	hour: number,
	recipient: string,
): string => {
	const vcalendar = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Remit e2e//Invitation//EN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${invite.uid}`,
		"DTSTAMP:20260901T090000Z",
		"SEQUENCE:0",
		`DTSTART:${at(hour)}`,
		`DTEND:${at(hour + 1)}`,
		`SUMMARY:${invite.summary}`,
		`ORGANIZER:mailto:${invite.sender}`,
		`ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${recipient}`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");
	return [
		`From: Organiser <${invite.sender}>`,
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

const rail = (page: Page): Locator =>
	page.getByRole("complementary").filter({ hasText: "Intelligence" }).first();

/**
 * Deliver the invitation, open it, and wait for the server to have read a
 * suggestion out of it. The page is reloaded once the suggestion exists so
 * the card is drawn from the server's answer rather than from a first read
 * that raced the body sync.
 */
const deliverAndOpen = async (
	page: Page,
	api: ApiClient,
	run: RunState,
	invite: Invitation,
	hour: number,
): Promise<CalendarSuggestion> => {
	await appendRawMessage(
		run.imapUser,
		invitationMessage(invite, hour, run.imapUser),
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
	expect(pending.organizer).toBe(invite.sender);

	await page.reload();
	await expect(rail(page)).toBeVisible({ timeout: 30_000 });
	await expect(rail(page).getByText(invite.summary)).toBeVisible({
		timeout: 30_000,
	});
	return pending;
};

const settledState = (
	api: ApiClient,
	messageId: string,
	state: CalendarSuggestion["state"],
): Promise<CalendarSuggestion[]> =>
	waitFor(
		() => api.listMessageCalendarSuggestions(messageId),
		(items) => items.some((item) => item.state === state),
		{ what: `the suggestion to be ${state} on the server` },
	);

const createdObjects: { calendarObjectId: string; calendarId: string }[] = [];
const deliveredMessages: string[] = [];
const mutedSenders: string[] = [];

test.afterAll(async () => {
	const run = readRunState();
	const api = new ApiClient(run);
	// A card left pending is drawn beside every later calendar spec, and its
	// buttons share names with the composer's.
	for (const messageId of deliveredMessages) {
		for (const suggestion of await api.listMessageCalendarSuggestions(
			messageId,
		)) {
			if (suggestion.state === "Pending")
				await api.dismissCalendarSuggestion(suggestion.suggestionId);
		}
	}
	for (const created of createdObjects)
		await api.deleteCalendarEvent(created.calendarObjectId, created.calendarId);
	if (mutedSenders.length > 0) {
		for (const filter of await api.listFilters(run.accountId)) {
			if (mutedSenders.some((sender) => filter.name.includes(sender)))
				await api.deleteFilter(run.accountId, filter.filterId);
		}
	}
	for (const mailbox of await api.listMailboxes(run.accountId)) {
		const ids = await api.searchMatchingMessageIds(mailbox.mailboxId, TAG);
		if (ids.length > 0) await api.deleteMessages(ids);
	}
});

test.describe("An invitation beside the message it came in", () => {
	test.describe.configure({ mode: "serial" });

	test("adding it writes the event the server serves back", async ({
		page,
		api,
		run,
	}) => {
		const invite = invitation("accept");
		const pending = await deliverAndOpen(page, api, run, invite, 9);

		const card = rail(page);
		await expect(card.getByText(/is not notified/)).toBeVisible();
		await card
			.getByRole("button", { name: "Add to calendar", exact: true })
			.click();

		await expect(card.getByRole("alert")).toHaveCount(0);
		await expect(card.getByText("On your calendar")).toBeVisible({
			timeout: 30_000,
		});

		const settled = await settledState(api, pending.messageId, "Accepted");
		const accepted = settled.find((item) => item.state === "Accepted");
		expect(accepted?.acceptedCalendarObjectId).not.toBe("");

		const events = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === invite.summary),
			{ what: `"${invite.summary}" to be on the calendar` },
		);
		const stored = events.find((item) => item.summary === invite.summary);
		if (!stored) throw new Error("unreachable: matched but not found");
		createdObjects.push({
			calendarObjectId: stored.calendarObjectId,
			calendarId: stored.calendarId,
		});
		expect(stored.calendarObjectId).toBe(accepted?.acceptedCalendarObjectId);
		expect(new Date(stored.start).toISOString()).toBe(
			new Date(pending.dtStart).toISOString(),
		);
	});

	test("declining writes nothing to the calendar", async ({
		page,
		api,
		run,
	}) => {
		const invite = invitation("decline");
		const pending = await deliverAndOpen(page, api, run, invite, 12);

		const card = rail(page);
		await card.getByRole("button", { name: "Decline", exact: true }).click();
		await expect(card.getByText("You declined")).toBeVisible({
			timeout: 30_000,
		});

		const settled = await settledState(api, pending.messageId, "Declined");
		expect(
			settled.find((item) => item.state === "Declined")
				?.acceptedCalendarObjectId,
		).toBe("");
		const events = await api.listCalendarEvents(WINDOW.from, WINDOW.to);
		expect(events.map((item) => item.summary)).not.toContain(invite.summary);
	});

	test("muting the organiser dismisses the card and writes a sender rule", async ({
		page,
		api,
		run,
	}) => {
		const invite = invitation("mute");
		const pending = await deliverAndOpen(page, api, run, invite, 15);
		mutedSenders.push(invite.sender);

		const card = rail(page);
		await card
			.getByRole("button", {
				name: `Stop offering invitations from ${invite.sender}`,
			})
			.click();
		await expect(card.getByText(invite.summary)).toHaveCount(0, {
			timeout: 30_000,
		});

		await settledState(api, pending.messageId, "Dismissed");
		const rules = await waitFor(
			() => api.listFilters(run.accountId),
			(items) => items.some((item) => item.name.includes(invite.sender)),
			{ what: `a rule muting ${invite.sender}` },
		);
		const rule = rules.find((item) => item.name.includes(invite.sender));
		expect(rule?.scope).toBe("Standing");
		expect(rule?.state).toBe("Active");
		const events = await api.listCalendarEvents(WINDOW.from, WINDOW.to);
		expect(events.map((item) => item.summary)).not.toContain(invite.summary);
	});
});
