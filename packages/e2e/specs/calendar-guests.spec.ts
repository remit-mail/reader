/**
 * Guests, end to end over the public API and the mail servers (reader#1508).
 *
 * An organizer invites a guest; the invitation leaves through the outbox as a
 * `text/calendar; method=REQUEST` part the sink accepts. The bytes are then
 * delivered into the guest's own Dovecot inbox, the way the guest's provider
 * would, and the guest answers from the stored event. The REPLY goes back the
 * same way and lands as the guest's answer on the organizer's copy. A delete
 * answers with one cancellation per guest.
 *
 * Nothing is mocked: every message crosses SMTP and IMAP.
 */
import { ApiClient, type CalendarEventResource, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const STAMP = Date.now();
const SUMMARY = `Guests e2e ${STAMP}`;
const START = "2027-04-14T09:00:00+00:00";
const END = "2027-04-14T10:00:00+00:00";
const WINDOW = {
	from: "2027-04-13T00:00:00+00:00",
	to: "2027-04-16T00:00:00+00:00",
};

const apiOf = (run: IsolatedRun): ApiClient =>
	new ApiClient({
		email: run.email,
		password: run.password,
		token: run.token,
	});

const calendarPart = (raw: string): string => {
	const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
	return unfolded.match(/Content-Type: text\/calendar;[^\r\n]*/i)?.[0] ?? "";
};

/** What the guest's provider does with an accepted submission: put it in their inbox. */
const deliver = async (raw: string, to: IsolatedRun): Promise<void> => {
	await appendRawMessage(to.imapUser, raw);
	await apiOf(to).triggerSync(to.accountId);
};

test.describe
	.serial("Inviting a guest", () => {
		test.setTimeout(240_000);

		let organizer: IsolatedRun;
		let guest: IsolatedRun;
		let event: CalendarEventResource;

		test.beforeAll(async () => {
			organizer = await provisionIsolatedRun("Guests organizer");
			guest = await provisionIsolatedRun("Guests guest");
		});

		test("the default invitation sender is a setting of its own", async () => {
			const api = apiOf(organizer);
			const unset = await api.request("GET", "/settings");
			expect(await unset.json()).toMatchObject({
				defaultInvitationSenderAccountId: organizer.accountId,
				defaultInvitationSenderChosen: false,
			});

			const set = await api.request("PATCH", "/settings", {
				defaultInvitationSenderAccountId: organizer.accountId,
			});
			expect(set.status).toBe(200);
			expect(await set.json()).toMatchObject({
				defaultInvitationSenderAccountId: organizer.accountId,
				defaultInvitationSenderChosen: true,
			});

			const cleared = await api.request(
				"DELETE",
				"/settings/default-invitation-sender",
			);
			expect(await cleared.json()).toMatchObject({
				defaultInvitationSenderAccountId: organizer.accountId,
				defaultInvitationSenderChosen: false,
			});

			const foreign = await api.request("PATCH", "/settings", {
				defaultInvitationSenderAccountId: guest.accountId,
			});
			expect(foreign.status).toBe(400);
		});

		test("a save with a guest sends them an invitation (FF1.2, FF1.10)", async () => {
			const api = apiOf(organizer);
			const [calendar] = (await api.listCalendars()).filter(
				(collection) => collection.componentSet === "VeventOnly",
			);
			expect(calendar).toBeDefined();

			event = await api.createCalendarEvent({
				calendarId: calendar?.calendarId ?? "",
				summary: SUMMARY,
				start: START,
				end: END,
				attendees: [{ email: guest.imapUser, displayName: "The Guest" }],
				organizerAccountId: organizer.accountId,
			});

			expect(event.participation).toBe("Organizer");
			expect(event.organizer).toBe(organizer.imapUser);
			expect(event.attendeeCounts).toEqual({
				accepted: 1,
				declined: 0,
				tentative: 0,
				needsAction: 1,
			});
			expect(event.sends).toEqual([
				expect.objectContaining({ email: guest.imapUser, method: "Request" }),
			]);

			const invitation = await waitForAcceptedMessage(`Invitation: ${SUMMARY}`);
			expect(calendarPart(invitation.raw)).toMatch(/method=REQUEST/i);
			await deliver(invitation.raw, guest);
		});

		test("the guest answers from the stored event and the organizer sees it (FF3.2, FF3.7, FF1.9)", async () => {
			const api = apiOf(guest);
			const card = (
				await waitFor(
					() => api.listPendingCalendarSuggestions(),
					(cards) => cards.some((item) => item.summary === SUMMARY),
					{ timeoutMs: 90_000, what: "the invitation card" },
				)
			).find((item) => item.summary === SUMMARY);
			const [inbox] = (await api.listCalendars()).filter(
				(collection) => collection.urlSegment === "default",
			);
			await api.acceptCalendarSuggestion(
				card?.suggestionId ?? "",
				inbox?.calendarId ?? "",
			);

			const [accepted] = (
				await api.listCalendarEvents(WINDOW.from, WINDOW.to)
			).filter((instance) => instance.summary === SUMMARY);
			expect(accepted?.participation).toBe("Accepted");

			const declined = await api.updateCalendarEvent(
				accepted?.calendarObjectId ?? "",
				accepted?.calendarId ?? "",
				{ answer: "Declined" },
			);
			expect(declined.participation).toBe("Declined");
			expect(declined.sends).toEqual([
				expect.objectContaining({ email: organizer.imapUser, method: "Reply" }),
			]);
			const [listed] = (
				await api.listCalendarEvents(WINDOW.from, WINDOW.to)
			).filter((instance) => instance.summary === SUMMARY);
			expect(listed?.participation).toBe("Declined");

			const reply = await waitForAcceptedMessage(`Declined: ${SUMMARY}`);
			expect(calendarPart(reply.raw)).toMatch(/method=REPLY/i);
			await deliver(reply.raw, organizer);

			const organizerApi = apiOf(organizer);
			const answered = await waitFor(
				() =>
					organizerApi.getCalendarEvent(
						event.calendarObjectId,
						event.calendarId,
					),
				(resource) => resource.attendeeCounts.declined === 1,
				{
					timeoutMs: 90_000,
					what: "the guest's answer on the organizer's copy",
				},
			);
			expect(
				answered.attendees.find((attendee) => attendee.email === guest.imapUser)
					?.status,
			).toBe("Declined");
			expect(
				await organizerApi.listPendingCalendarSuggestions(),
			).not.toContainEqual(expect.objectContaining({ summary: SUMMARY }));
		});

		test("moving the event sends the guest an update with a higher SEQUENCE (FF1.3)", async () => {
			const api = apiOf(organizer);
			const moved = await api.updateCalendarEvent(
				event.calendarObjectId,
				event.calendarId,
				{
					start: "2027-04-14T11:00:00+00:00",
					end: "2027-04-14T12:00:00+00:00",
				},
			);
			expect(moved.sequence).toBeGreaterThan(event.sequence);
			expect(moved.sends).toEqual([
				expect.objectContaining({ email: guest.imapUser, method: "Request" }),
			]);
		});

		test("deleting the event answers 200 with a cancellation per guest (FF1.3)", async () => {
			const api = apiOf(organizer);
			const response = await api.deleteCalendarEvent(
				event.calendarObjectId,
				event.calendarId,
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				sends: [
					expect.objectContaining({ email: guest.imapUser, method: "Cancel" }),
				],
			});
			const cancellation = await waitForAcceptedMessage(
				`Cancelled: ${SUMMARY}`,
			);
			expect(calendarPart(cancellation.raw)).toMatch(/method=CANCEL/i);
		});
	});
