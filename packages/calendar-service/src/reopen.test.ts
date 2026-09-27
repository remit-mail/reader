import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarInviteAnswer as CalendarInviteAnswerValue } from "@remit/api-openapi-types";
import type { CalendarSuggestionItem } from "@remit/data-ports";
import {
	CalendarAnswerOvertaken,
	CalendarInviteAnswer,
	CalendarSuggestionSource,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import { acceptCalendarSuggestion } from "./accept.js";
import { ical } from "./fixtures.js";
import { MemoryCalendarStore } from "./memory-store.js";
import {
	deleteCalendarObject,
	provisionDefaultCalendar,
	putCalendarObject,
} from "./put.js";
import { answersOvertakenBy, reopenCalendarSuggestion } from "./reopen.js";
import { followingUidOf, followingUidPrefix } from "./scope.js";
import { recordCalendarSuggestion } from "./suggest.js";

const ACCOUNT_CONFIG_ID = "account-config-1";
const ATTENDEE = "user@example.test";

const invitation = (
	uid: string,
	{
		method = "REQUEST",
		sequence = 0,
	}: { method?: "REQUEST" | "CANCEL"; sequence?: number } = {},
): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Example Corp//Scheduler//EN",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		`UID:${uid}`,
		"DTSTAMP:20260801T090000Z",
		`SEQUENCE:${sequence}`,
		"DTSTART:20260901T080000Z",
		"DTEND:20260901T090000Z",
		"RRULE:FREQ=WEEKLY;COUNT=4",
		"SUMMARY:Quarterly review",
		"ORGANIZER:mailto:organizer@example.test",
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.test",
		"END:VEVENT",
		"END:VCALENDAR",
	);

const provisioned = async (): Promise<{
	store: MemoryCalendarStore;
	calendarId: string;
}> => {
	const store = new MemoryCalendarStore();
	const collection = await provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID);
	return { store, calendarId: collection.calendarId };
};

const recorded = async (
	store: MemoryCalendarStore,
	uid: string,
	messageId: string,
	options: { method?: "REQUEST" | "CANCEL"; sequence?: number } = {},
): Promise<CalendarSuggestionItem> => {
	const result = await recordCalendarSuggestion(store.calendarSuggestion, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		messageId,
		bodyPartId: "body-part-1",
		source: CalendarSuggestionSource.IcalendarPart,
		icalData: invitation(uid, options),
		timezone: "UTC",
	});
	assert.ok(result.ok);
	return result.value.suggestion;
};

const answered = async (
	store: MemoryCalendarStore,
	calendarId: string,
	suggestion: CalendarSuggestionItem,
	answer: CalendarInviteAnswerValue,
): Promise<CalendarSuggestionItem> => {
	const result = await acceptCalendarSuggestion(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		calendarId,
		suggestion,
		attendee: ATTENDEE,
		answer,
	});
	assert.ok(result.ok);
	return result.value.suggestion;
};

const reopen = (
	store: MemoryCalendarStore,
	suggestion: CalendarSuggestionItem,
) =>
	reopenCalendarSuggestion(store, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		suggestion,
	});

const reopened = async (
	store: MemoryCalendarStore,
	suggestion: CalendarSuggestionItem,
): Promise<CalendarSuggestionItem> => {
	const result = await reopen(store, suggestion);
	assert.ok(result.ok, JSON.stringify(result));
	return result.value;
};

const answerOf = async (
	store: MemoryCalendarStore,
	suggestion: CalendarSuggestionItem,
) => {
	const [answered] = await answersOvertakenBy(
		store.calendarSuggestion,
		ACCOUNT_CONFIG_ID,
		[suggestion],
	);
	return answered?.answerOvertakenBy;
};

const secondCalendar = (store: MemoryCalendarStore) =>
	store.transaction((repos) =>
		repos.calendarCollection.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			urlSegment: "personal",
			displayName: "Personal",
		}),
	);

describe("reopenCalendarSuggestion", () => {
	for (const answer of [
		CalendarInviteAnswer.Accepted,
		CalendarInviteAnswer.Tentative,
	]) {
		it(`takes a ${answer} answer back: the event and its occurrences leave, the card is Pending`, async () => {
			const { store, calendarId } = await provisioned();
			const card = await answered(
				store,
				calendarId,
				await recorded(store, "invite-1@example.test", "message-1"),
				answer,
			);
			const written = card.acceptedCalendarObjectId;
			const sequenceBefore = store.collections.get(calendarId)?.syncSequence;

			const back = await reopened(store, card);

			assert.equal(back.state, CalendarSuggestionState.Pending);
			assert.equal(back.acceptedCalendarObjectId, "");
			assert.equal(store.objects.has(written), false);
			assert.equal(store.occurrences.get(written)?.length ?? 0, 0);
			assert.ok(
				(store.collections.get(calendarId)?.syncSequence ?? 0) >
					(sequenceBefore ?? 0),
			);
			assert.equal(
				store.suggestions.get(card.suggestionId)?.state,
				CalendarSuggestionState.Pending,
			);
		});
	}

	it("a reopened card can be answered again", async () => {
		const { store, calendarId } = await provisioned();
		const card = await answered(
			store,
			calendarId,
			await recorded(store, "invite-1@example.test", "message-1"),
			CalendarInviteAnswer.Accepted,
		);

		const again = await answered(
			store,
			calendarId,
			await reopened(store, card),
			CalendarInviteAnswer.Tentative,
		);

		assert.equal(again.state, CalendarSuggestionState.Tentative);
		assert.equal(store.objects.size, 1);
		assert.ok(store.objects.has(again.acceptedCalendarObjectId));
	});

	it("removes the remainder a this-and-following edit split off, so a re-add does not duplicate", async () => {
		const { store, calendarId } = await provisioned();
		const uid = "invite-1@example.test";
		const card = await answered(
			store,
			calendarId,
			await recorded(store, uid, "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		const head = store.objects.get(card.acceptedCalendarObjectId);
		assert.ok(head);
		const tailUid = followingUidOf(uid, "split-1@reader.remit");
		const tail = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "split-1.ics",
			icalData: head.icalData.replace(`UID:${uid}`, `UID:${tailUid}`),
		});
		assert.ok(tail.ok);
		const tailOfTail = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "split-2.ics",
			icalData: head.icalData.replace(
				`UID:${uid}`,
				`UID:${followingUidOf(tailUid, "split-2@reader.remit")}`,
			),
		});
		assert.ok(tailOfTail.ok);
		assert.equal(store.objects.size, 3);

		const back = await reopened(store, card);
		assert.equal(store.objects.size, 0);
		assert.equal(
			store.occurrences.get(tail.value.calendarObjectId)?.length ?? 0,
			0,
		);

		await answered(store, calendarId, back, CalendarInviteAnswer.Accepted);
		assert.equal(store.objects.size, 1);
	});

	for (const second of [
		{ name: "a resend at the same SEQUENCE", sequence: 0 },
		{ name: "a later revision", sequence: 1 },
	]) {
		it(`keeps the event while ${second.name} still holds it, and removes it with the last answer`, async () => {
			const { store, calendarId } = await provisioned();
			const uid = "invite-1@example.test";
			const first = await answered(
				store,
				calendarId,
				await recorded(store, uid, "message-1"),
				CalendarInviteAnswer.Accepted,
			);
			const other = await answered(
				store,
				calendarId,
				await recorded(store, uid, "message-2", { sequence: second.sequence }),
				CalendarInviteAnswer.Tentative,
			);
			const event = first.acceptedCalendarObjectId;
			assert.equal(other.acceptedCalendarObjectId, event);
			assert.equal(await answerOf(store, first), CalendarAnswerOvertaken.None);

			const firstBack = await reopened(store, first);

			assert.equal(firstBack.state, CalendarSuggestionState.Pending);
			assert.equal(firstBack.acceptedCalendarObjectId, "");
			assert.ok(store.objects.has(event), "the other answer still holds it");
			assert.equal(
				store.suggestions.get(other.suggestionId)?.acceptedCalendarObjectId,
				event,
			);

			const otherBack = await reopened(store, other);

			assert.equal(otherBack.state, CalendarSuggestionState.Pending);
			assert.equal(store.objects.has(event), false);
		});
	}

	it("takes back only the parts in the calendar that holds the answered event", async () => {
		const { store, calendarId: work } = await provisioned();
		const personal = (await secondCalendar(store)).calendarId;
		const uid = "invite-1@example.test";
		const first = await answered(
			store,
			work,
			await recorded(store, uid, "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		const second = await answered(
			store,
			personal,
			await recorded(store, uid, "message-2", { sequence: 1 }),
			CalendarInviteAnswer.Accepted,
		);
		assert.notEqual(
			first.acceptedCalendarObjectId,
			second.acceptedCalendarObjectId,
		);
		const personalHead = store.objects.get(second.acceptedCalendarObjectId);
		assert.ok(personalHead);
		const personalTail = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId: personal,
			resourceName: "split-1.ics",
			icalData: personalHead.icalData.replace(
				`UID:${uid}`,
				`UID:${followingUidOf(uid, "split-1@reader.remit")}`,
			),
		});
		assert.ok(personalTail.ok);

		await reopened(store, first);

		assert.equal(store.objects.has(first.acceptedCalendarObjectId), false);
		assert.ok(store.objects.has(second.acceptedCalendarObjectId));
		assert.ok(store.objects.has(personalTail.value.calendarObjectId));
	});

	it("leaves a remainder split off before split UIDs were derived", async () => {
		const { store, calendarId } = await provisioned();
		const uid = "invite-1@example.test";
		const card = await answered(
			store,
			calendarId,
			await recorded(store, uid, "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		const head = store.objects.get(card.acceptedCalendarObjectId);
		assert.ok(head);
		const legacy = await putCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			resourceName: "legacy.ics",
			icalData: head.icalData
				.replace(`UID:${uid}`, "UID:legacy-1@reader.remit")
				.replace("DTSTART:20260901T080000Z", "DTSTART:20260915T080000Z")
				.replace("DTEND:20260901T090000Z", "DTEND:20260915T090000Z"),
		});
		assert.ok(legacy.ok, JSON.stringify(legacy));

		await reopened(store, card);

		assert.equal(store.objects.has(card.acceptedCalendarObjectId), false);
		assert.ok(store.objects.has(legacy.value.calendarObjectId));
	});

	it("refuses to take back a request's answer once its cancellation was answered into the same event", async () => {
		const { store, calendarId } = await provisioned();
		const uid = "invite-1@example.test";
		const request = await answered(
			store,
			calendarId,
			await recorded(store, uid, "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		const cancel = await answered(
			store,
			calendarId,
			await recorded(store, uid, "message-2", { method: "CANCEL" }),
			CalendarInviteAnswer.Accepted,
		);
		assert.equal(
			request.acceptedCalendarObjectId,
			cancel.acceptedCalendarObjectId,
		);

		const refused = await reopen(store, request);

		assert.equal(refused.ok, false);
		assert.equal(!refused.ok && refused.error.code, "AnswerOvertaken");
		assert.ok(store.objects.has(cancel.acceptedCalendarObjectId));
		assert.equal(
			await answerOf(store, request),
			CalendarAnswerOvertaken.Cancellation,
		);
	});

	it("refuses a superseded card and a cancellation card", async () => {
		const { store } = await provisioned();
		const pending = await recorded(store, "invite-1@example.test", "message-1");
		const cancel = await recorded(store, "invite-2@example.test", "message-2", {
			method: "CANCEL",
		});

		for (const card of [
			{ ...pending, state: CalendarSuggestionState.Superseded },
			{ ...cancel, state: CalendarSuggestionState.Dismissed },
		]) {
			const refused = await reopen(store, card);
			assert.equal(!refused.ok && refused.error.code, "NotReopenable");
		}
	});

	it("leaves every other event in the calendar alone", async () => {
		const { store, calendarId } = await provisioned();
		const other = await answered(
			store,
			calendarId,
			await recorded(store, "invite-2@example.test", "message-2"),
			CalendarInviteAnswer.Accepted,
		);
		const card = await answered(
			store,
			calendarId,
			await recorded(store, "invite-1@example.test", "message-1"),
			CalendarInviteAnswer.Accepted,
		);

		await reopened(store, card);

		assert.deepEqual(
			[...store.objects.keys()],
			[other.acceptedCalendarObjectId],
		);
	});

	it("reopens a declined card without touching the calendar", async () => {
		const { store, calendarId } = await provisioned();
		const kept = await answered(
			store,
			calendarId,
			await recorded(store, "invite-2@example.test", "message-2"),
			CalendarInviteAnswer.Accepted,
		);
		const pending = await recorded(store, "invite-1@example.test", "message-1");
		const declined = await store.calendarSuggestion.settle(
			ACCOUNT_CONFIG_ID,
			pending.suggestionId,
			{ state: CalendarSuggestionState.Declined, acceptedCalendarObjectId: "" },
		);
		const sequenceBefore = store.collections.get(calendarId)?.syncSequence;

		const back = await reopened(store, declined);

		assert.equal(back.state, CalendarSuggestionState.Pending);
		assert.ok(store.objects.has(kept.acceptedCalendarObjectId));
		assert.equal(
			store.collections.get(calendarId)?.syncSequence,
			sequenceBefore,
		);
	});

	it("still reopens when the event was already deleted from the calendar", async () => {
		const { store, calendarId } = await provisioned();
		const card = await answered(
			store,
			calendarId,
			await recorded(store, "invite-1@example.test", "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		await deleteCalendarObject(store, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			calendarId,
			calendarObjectId: card.acceptedCalendarObjectId,
		});

		const back = await reopened(store, card);

		assert.equal(back.state, CalendarSuggestionState.Pending);
		assert.equal(back.acceptedCalendarObjectId, "");
	});

	it("returns a Pending card as it is", async () => {
		const { store } = await provisioned();
		const pending = await recorded(store, "invite-1@example.test", "message-1");

		assert.deepEqual(await reopened(store, pending), pending);
	});
});

describe("followingUidOf", () => {
	it("keeps every split of a series under the first event's UID", () => {
		const once = followingUidOf("root@example.test", "a");
		const twice = followingUidOf(once, "b");

		assert.ok(once.startsWith(followingUidPrefix("root@example.test")));
		assert.ok(twice.startsWith(followingUidPrefix("root@example.test")));
		assert.equal(followingUidPrefix(twice), followingUidPrefix(once));
	});
});

describe("answersOvertakenBy", () => {
	it("reads the holders of a whole page in one lookup", async () => {
		const { store, calendarId } = await provisioned();
		const request = await answered(
			store,
			calendarId,
			await recorded(store, "invite-1@example.test", "message-1"),
			CalendarInviteAnswer.Accepted,
		);
		await answered(
			store,
			calendarId,
			await recorded(store, "invite-1@example.test", "message-2", {
				method: "CANCEL",
			}),
			CalendarInviteAnswer.Accepted,
		);
		const other = await answered(
			store,
			calendarId,
			await recorded(store, "invite-2@example.test", "message-3"),
			CalendarInviteAnswer.Accepted,
		);
		const pending = await recorded(store, "invite-3@example.test", "message-4");
		const reads: string[][] = [];
		const counting = {
			listByAcceptedCalendarObjects: (
				accountConfigId: string,
				calendarObjectIds: string[],
			) => {
				reads.push(calendarObjectIds);
				return store.calendarSuggestion.listByAcceptedCalendarObjects(
					accountConfigId,
					calendarObjectIds,
				);
			},
		};

		const page = await answersOvertakenBy(counting, ACCOUNT_CONFIG_ID, [
			request,
			other,
			pending,
		]);

		assert.equal(reads.length, 1);
		assert.deepEqual(
			page.map((entry) => [
				entry.suggestion.suggestionId,
				entry.answerOvertakenBy,
			]),
			[
				[request.suggestionId, CalendarAnswerOvertaken.Cancellation],
				[other.suggestionId, CalendarAnswerOvertaken.None],
				[pending.suggestionId, CalendarAnswerOvertaken.None],
			],
		);
	});
});
