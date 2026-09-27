import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	acceptCalendarSuggestion,
	reopenCalendarSuggestion,
} from "@remit/calendar-service";
import type {
	CalendarSuggestionItem,
	CreateFilterInput,
	FilterItem,
	ICalendarSuggestionRepository,
	ICalendarUnitOfWork,
	MessageData,
	PutCalendarSuggestionInput,
	SettleCalendarSuggestionInput,
} from "@remit/data-ports";
import {
	CalendarAnswerOvertaken,
	CalendarInviteAnswer,
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
	FilterState,
	RecurrenceScope,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { calendarDepsOf } from "./calendar.js";
import {
	calendarEventDepsOf,
	updateCalendarEventFor,
} from "./calendar-event.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import {
	assertSettleable,
	CalendarSuggestionActionOperations,
	CalendarSuggestionOperations,
	MessageCalendarSuggestionOperations,
	type MuteSenderDeps,
	muteSender,
	settleSuggestion,
	toCalendarSuggestionResponse,
} from "./calendar-suggestion.js";

const ACCOUNT_CONFIG_ID = "cfg-1";

const suggestion = (
	overrides: Partial<CalendarSuggestionItem> = {},
): CalendarSuggestionItem => ({
	suggestionId: "sug-1",
	accountConfigId: ACCOUNT_CONFIG_ID,
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "invite@example.test",
	sequence: 0,
	method: CalendarInviteMethod.Request,
	source: CalendarSuggestionSource.IcalendarPart,
	state: CalendarSuggestionState.Pending,
	summary: "Quarterly review",
	dtStart: "2026-09-01T10:00:00+02:00",
	dtEnd: "2026-09-01T11:00:00+02:00",
	allDay: false,
	location: "Room 4",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	icalData: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
	acceptedCalendarObjectId: "",
	supersededByMessageId: "",
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const repoOf = (
	initial: CalendarSuggestionItem,
): {
	repo: ICalendarSuggestionRepository;
	settles: SettleCalendarSuggestionInput[];
} => {
	let row = initial;
	const settles: SettleCalendarSuggestionInput[] = [];
	const repo = {
		get: async () => row,
		settle: async (
			_accountConfigId: string,
			_suggestionId: string,
			input: SettleCalendarSuggestionInput,
		) => {
			settles.push(input);
			row = { ...row, ...input };
			return row;
		},
	} as unknown as ICalendarSuggestionRepository;
	return { repo, settles };
};

const muteDepsOf = (
	from: string | null,
	existing: FilterItem[] = [],
): { deps: MuteSenderDeps; created: CreateFilterInput[] } => {
	const created: CreateFilterInput[] = [];
	const rules = [...existing];
	const deps: MuteSenderDeps = {
		envelope: {
			getMessageData: async () =>
				({
					envelopeAddress: from
						? [{ addressRole: "from", normalizedEmail: from }]
						: [{ addressRole: "to", normalizedEmail: "user@example.test" }],
				}) as unknown as MessageData,
		},
		filter: {
			listByAccountAndState: async () => rules,
			create: async (input: CreateFilterInput) => {
				created.push(input);
				const row = {
					...input,
					actionLabelId: input.actionLabelId ?? "None",
					actionMailboxId: input.actionMailboxId ?? "None",
				} as unknown as FilterItem;
				rules.push(row);
				return row;
			},
		},
	};
	return { deps, created };
};

const muteRule = (sender: string): FilterItem =>
	({
		filterId: `mute-${sender}`,
		accountConfigId: ACCOUNT_CONFIG_ID,
		name: `Muted invitations from ${sender}`,
		scope: "Standing",
		state: "Active",
		matchOperator: "And",
		literalClauses: [{ field: "From", value: sender }],
		actionLabelId: "None",
		actionMailboxId: "None",
	}) as unknown as FilterItem;

describe("toCalendarSuggestionResponse", () => {
	test("keeps the raw invitation bytes on the server", async () => {
		const response = toCalendarSuggestionResponse(
			suggestion(),
			CalendarAnswerOvertaken.None,
		);

		assert.equal("icalData" in response, false);
		assert.equal(response.summary, "Quarterly review");
		assert.equal(response.organizer, "organizer@example.test");
	});
});

describe("assertSettleable", () => {
	test("lets a pending card be answered", () => {
		assertSettleable(suggestion(), CalendarSuggestionState.Accepted);
	});

	test("refuses to accept an event a revision already retired", () => {
		assert.throws(
			() =>
				assertSettleable(
					suggestion({ state: CalendarSuggestionState.Superseded }),
					CalendarSuggestionState.Accepted,
				),
			/already superseded/,
		);
	});

	test("refuses to decline an event that is already in the calendar", () => {
		// A resource exists. Declining would say no to a meeting the user's
		// calendar still shows, which is a lie the API must not tell.
		assert.throws(
			() =>
				assertSettleable(
					suggestion({ state: CalendarSuggestionState.Accepted }),
					CalendarSuggestionState.Declined,
				),
			/already accepted/,
		);
	});

	test("lets a repeat of the same answer through", () => {
		assertSettleable(
			suggestion({ state: CalendarSuggestionState.Declined }),
			CalendarSuggestionState.Declined,
		);
	});
});

describe("settleSuggestion", () => {
	test("records a decline", async () => {
		const { repo, settles } = repoOf(suggestion());

		const settled = await settleSuggestion(
			repo,
			ACCOUNT_CONFIG_ID,
			"sug-1",
			CalendarSuggestionState.Declined,
		);

		assert.equal(settled.state, CalendarSuggestionState.Declined);
		assert.deepEqual(settles, [
			{
				state: CalendarSuggestionState.Declined,
				acceptedCalendarObjectId: "",
			},
		]);
	});

	test("writes nothing on a repeated decline", async () => {
		const { repo, settles } = repoOf(
			suggestion({ state: CalendarSuggestionState.Declined }),
		);

		const settled = await settleSuggestion(
			repo,
			ACCOUNT_CONFIG_ID,
			"sug-1",
			CalendarSuggestionState.Declined,
		);

		assert.equal(settled.state, CalendarSuggestionState.Declined);
		assert.deepEqual(settles, []);
	});

	test("never names a calendar object on a decision that wrote none", async () => {
		// Dismiss and decline write no resource, so the field that points at one
		// stays the empty sentinel rather than carrying a stale id.
		const { repo, settles } = repoOf(suggestion());

		await settleSuggestion(
			repo,
			ACCOUNT_CONFIG_ID,
			"sug-1",
			CalendarSuggestionState.Dismissed,
		);

		assert.deepEqual(
			settles.map((settle) => settle.acceptedCalendarObjectId),
			[""],
		);
	});
});

describe("muteSender", () => {
	test("writes a standing rule on the message's sender", async () => {
		const { deps, created } = muteDepsOf("organizer@example.test");

		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1");

		assert.equal(created.length, 1);
		assert.equal(created[0]?.accountConfigId, ACCOUNT_CONFIG_ID);
		assert.equal(created[0]?.scope, "Standing");
		assert.deepEqual(created[0]?.literalClauses, [
			{ field: "From", value: "organizer@example.test" },
		]);
		assert.match(created[0]?.name ?? "", /organizer@example\.test/);
	});

	test("writes one rule however often the dismiss is retried", async () => {
		// A retried dismiss is the same instruction repeated. A second identical
		// rule would only be a second row for the user to find and delete twice.
		const { deps, created } = muteDepsOf("organizer@example.test");

		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1");
		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1");
		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-2");

		assert.equal(created.length, 1);
	});

	test("adds nothing when the sender is already muted from another card", async () => {
		const { deps, created } = muteDepsOf("organizer@example.test", [
			muteRule("Organizer@Example.test"),
		]);

		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1");

		assert.deepEqual(created, []);
	});

	test("still writes a rule when the existing one names a different sender", async () => {
		const { deps, created } = muteDepsOf("organizer@example.test", [
			muteRule("someone-else@example.test"),
		]);

		await muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1");

		assert.equal(created.length, 1);
	});

	test("refuses to mute a message that names no sender", async () => {
		const { deps, created } = muteDepsOf(null);

		await assert.rejects(
			() => muteSender(deps, ACCOUNT_CONFIG_ID, "msg-1"),
			/nobody to mute/,
		);
		assert.deepEqual(created, []);
	});
});

/**
 * The suggestion wrappers driven the way an HTTP request drives them — through
 * the registered client — against the SQLite store the self-host build ships.
 * The unit tests above pin each half; these pin what one request does.
 */

type Handler = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<Record<string, unknown>>;

const listSuggestions =
	CalendarSuggestionOperations.CalendarSuggestionOperations_listCalendarSuggestions as Handler;
const acceptSuggestion =
	CalendarSuggestionActionOperations.CalendarSuggestionActionOperations_acceptCalendarSuggestion as Handler;
const dismissSuggestion =
	CalendarSuggestionActionOperations.CalendarSuggestionActionOperations_dismissCalendarSuggestion as Handler;
const listMessageSuggestions =
	MessageCalendarSuggestionOperations.MessageCalendarSuggestionOperations_listMessageCalendarSuggestions as Handler;
const reopenSuggestion =
	CalendarSuggestionActionOperations.CalendarSuggestionActionOperations_reopenCalendarSuggestion as Handler;

interface Card {
	suggestionId: string;
	state: string;
	supersededByMessageId: string;
	supersededByThreadId: string;
}

const fileInThread = async (
	accountConfigId: string,
	messageId: string,
	threadId: string,
): Promise<void> => {
	await client.threadMessage.create({
		accountConfigId,
		threadId,
		messageId,
		mailboxId: "mbx-inbox",
		uid: 1,
		referenceOrder: 0,
		internalDate: 1,
		sentDate: 1,
		subject: "Invitation: Quarterly review",
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});
};

let client: RemitClient;
let cleanup: () => void;
let mintedSubs = 0;

const contextOf = (request: {
	params?: Record<string, string>;
	query?: Record<string, unknown>;
	requestBody?: unknown;
}): Context => ({ request }) as unknown as Context;

const anAccount = (): {
	accountConfigId: string;
	event: APIGatewayProxyEvent;
} => {
	mintedSubs += 1;
	const sub = `calendar-suggestion-sub-${mintedSubs}`;
	return {
		accountConfigId: deriveAccountConfigId(sub),
		event: {
			requestContext: { authorizer: { claims: { sub } } },
		} as unknown as APIGatewayProxyEvent,
	};
};

const INVITATION = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"METHOD:REQUEST",
	"BEGIN:VEVENT",
	"UID:invite@example.test",
	"DTSTART:20260901T080000Z",
	"DTEND:20260901T090000Z",
	"SUMMARY:Quarterly review",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

const putSuggestion = (
	accountConfigId: string,
	messageId: string,
	method: CalendarSuggestionItem["method"] = CalendarInviteMethod.Request,
): Promise<CalendarSuggestionItem> =>
	client.calendarSuggestion.put({
		accountConfigId,
		messageId,
		bodyPartId: "part-1",
		icalUid: "invite@example.test",
		sequence: 0,
		method,
		source: CalendarSuggestionSource.IcalendarPart,
		summary: "Quarterly review",
		dtStart: "2026-09-01T10:00:00+02:00",
		dtEnd: "2026-09-01T11:00:00+02:00",
		allDay: false,
		location: "Room 4",
		organizer: "organizer@example.test",
		zoneCertainty: "Explicit",
		icalData: INVITATION,
	} as PutCalendarSuggestionInput);

/** A message with a From address, which is all muting a sender reads. */
const seedMessageFrom = async (
	messageId: string,
	sender: string,
): Promise<void> => {
	await client.envelope.createEnvelope({
		envelopeId: "",
		messageId,
		dateValue: Date.parse("2026-08-30T08:00:00Z"),
		dateRaw: "Sun, 30 Aug 2026 08:00:00 +0000",
		subject: "Invitation: Quarterly review",
		messageIdValue: `<${messageId}@example.test>`,
	});
	await client.address.createEnvelopeAddress({
		messageId,
		addressId: `address-${messageId}`,
		displayName: "The organiser",
		normalizedEmail: sender,
		addressRole: "from",
		addressOrder: 0,
	});
};

before(async () => {
	_resetForTest();
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
});

after(() => {
	_resetForTest();
	cleanup();
});

describe("GET /calendar-suggestions", () => {
	test("hands the pending set back one page at a time", async () => {
		const { accountConfigId, event } = anAccount();
		const seeded = await Promise.all(
			Array.from({ length: 101 }, (_unused, index) =>
				putSuggestion(accountConfigId, `msg-page-${index}`),
			),
		);

		const first = (await listSuggestions(
			contextOf({ query: { state: CalendarSuggestionState.Pending } }),
			event,
		)) as unknown as { items: Card[]; continuationToken?: string };
		assert.equal(first.items.length, 100);
		assert.ok(first.continuationToken, "a full page names where to continue");

		const second = (await listSuggestions(
			contextOf({
				query: {
					state: CalendarSuggestionState.Pending,
					continuationToken: first.continuationToken,
				},
			}),
			event,
		)) as unknown as { items: Card[]; continuationToken?: string };

		assert.equal(second.items.length, 1);
		assert.equal(second.continuationToken, undefined);
		const paged = new Set(
			[...first.items, ...second.items].map((card) => card.suggestionId),
		);
		assert.equal(
			paged.size,
			seeded.length,
			"the two pages cover the set once each, with no card in both",
		);
	});

	test("answers only the state that was asked for, and keeps the raw bytes back", async () => {
		const { accountConfigId, event } = anAccount();
		await putSuggestion(accountConfigId, "msg-pending");
		const dismissed = await putSuggestion(accountConfigId, "msg-dismissed");
		await client.calendarSuggestion.settle(
			accountConfigId,
			dismissed.suggestionId,
			{
				state: CalendarSuggestionState.Dismissed,
				acceptedCalendarObjectId: "",
			},
		);

		const pending = (await listSuggestions(
			contextOf({ query: { state: CalendarSuggestionState.Pending } }),
			event,
		)) as unknown as { items: Card[] };

		assert.deepEqual(
			pending.items.map((card) => card.state),
			[CalendarSuggestionState.Pending],
		);
		assert.equal("icalData" in (pending.items[0] ?? {}), false);
	});
});

describe("GET /messages/{messageId}/calendar-suggestions", () => {
	test("names the conversation of the revision that retired a card", async () => {
		const { accountConfigId, event } = anAccount();
		const older = await putSuggestion(accountConfigId, "msg-revision-0");
		await client.calendarSuggestion.supersedeIfPending(
			accountConfigId,
			older.suggestionId,
			"msg-revision-1",
		);
		await fileInThread(accountConfigId, "msg-revision-1", "thread-revision-1");

		const listed = (await listMessageSuggestions(
			contextOf({ params: { messageId: "msg-revision-0" } }),
			event,
		)) as unknown as { items: Card[] };

		assert.deepEqual(
			listed.items.map((card) => [
				card.state,
				card.supersededByMessageId,
				card.supersededByThreadId,
			]),
			[
				[
					CalendarSuggestionState.Superseded,
					"msg-revision-1",
					"thread-revision-1",
				],
			],
		);
	});

	test("names no conversation when the newer message sits in none", async () => {
		const { accountConfigId, event } = anAccount();
		const older = await putSuggestion(accountConfigId, "msg-orphan-0");
		await client.calendarSuggestion.supersedeIfPending(
			accountConfigId,
			older.suggestionId,
			"msg-orphan-1",
		);

		const listed = (await listMessageSuggestions(
			contextOf({ params: { messageId: "msg-orphan-0" } }),
			event,
		)) as unknown as { items: Card[] };

		assert.equal(listed.items[0]?.supersededByThreadId, "");
	});

	test("names no conversation for a card nothing retired", async () => {
		const { accountConfigId, event } = anAccount();
		await putSuggestion(accountConfigId, "msg-current");

		const listed = (await listMessageSuggestions(
			contextOf({ params: { messageId: "msg-current" } }),
			event,
		)) as unknown as { items: Card[] };

		assert.deepEqual(
			listed.items.map((card) => [
				card.supersededByMessageId,
				card.supersededByThreadId,
			]),
			[["", ""]],
		);
	});
});

describe("POST /calendar-suggestions/{suggestionId}/accept", () => {
	test("answers not-found for a calendar on another account, before writing anything", async () => {
		const stranger = anAccount();
		const strangersCalendar = await client.calendarCollection.create({
			accountConfigId: stranger.accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-cross-account");

		await assert.rejects(
			() =>
				acceptSuggestion(
					contextOf({
						params: { suggestionId: card.suggestionId },
						requestBody: { calendarId: strangersCalendar.calendarId },
					}),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 404,
		);

		assert.deepEqual(
			await client.calendarObject.listByCalendar(strangersCalendar.calendarId),
			[],
			"nothing was written into the calendar the caller does not hold",
		);
		const untouched = await client.calendarSuggestion.get(
			accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Pending);
		assert.equal(untouched.acceptedCalendarObjectId, "");
	});

	test("refuses a maybe to a cancellation, before writing anything", async () => {
		const { accountConfigId, event } = anAccount();
		const calendar = await client.calendarCollection.create({
			accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});
		const card = await putSuggestion(
			accountConfigId,
			"msg-cancel-maybe",
			CalendarInviteMethod.Cancel,
		);

		await assert.rejects(
			() =>
				acceptSuggestion(
					contextOf({
						params: { suggestionId: card.suggestionId },
						requestBody: {
							calendarId: calendar.calendarId,
							answer: CalendarInviteAnswer.Tentative,
						},
					}),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 400,
		);

		assert.deepEqual(
			await client.calendarObject.listByCalendar(calendar.calendarId),
			[],
		);
		const untouched = await client.calendarSuggestion.get(
			accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Pending);
	});
});

describe("POST /calendar-suggestions/{suggestionId}/dismiss", () => {
	test("settles the card and writes the sender's mute rule in one request", async () => {
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-mute");
		await seedMessageFrom("msg-mute", "organizer@example.test");

		const dismissed = (await dismissSuggestion(
			contextOf({
				params: { suggestionId: card.suggestionId },
				requestBody: { muteSender: true },
			}),
			event,
		)) as unknown as Card;

		assert.equal(dismissed.state, CalendarSuggestionState.Dismissed);
		const rules = await client.filter.listByAccountAndState(
			accountConfigId,
			FilterState.Active,
		);
		assert.equal(rules.length, 1);
		assert.deepEqual(rules[0]?.literalClauses, [
			{ field: "From", value: "organizer@example.test" },
		]);
	});

	test("writes no rule when the request does not ask to mute", async () => {
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-quiet");
		await seedMessageFrom("msg-quiet", "organizer@example.test");

		const dismissed = (await dismissSuggestion(
			contextOf({
				params: { suggestionId: card.suggestionId },
				requestBody: {},
			}),
			event,
		)) as unknown as Card;

		assert.equal(dismissed.state, CalendarSuggestionState.Dismissed);
		assert.deepEqual(
			await client.filter.listByAccountAndState(
				accountConfigId,
				FilterState.Active,
			),
			[],
		);
	});
});

describe("POST /calendar-suggestions/{suggestionId}/accept with corrections", () => {
	test("answers not-found for a calendar on another account, before writing anything", async () => {
		const stranger = anAccount();
		const strangersCalendar = await client.calendarCollection.create({
			accountConfigId: stranger.accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-edited-cross");

		await assert.rejects(
			() =>
				acceptSuggestion(
					contextOf({
						params: { suggestionId: card.suggestionId },
						requestBody: {
							calendarId: strangersCalendar.calendarId,
							event: { summary: "Quarterly review, moved" },
						},
					}),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 404,
		);

		assert.deepEqual(
			await client.calendarObject.listByCalendar(strangersCalendar.calendarId),
			[],
		);
		const untouched = await client.calendarSuggestion.get(
			accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Pending);
	});

	test("refuses a card the reader already declined", async () => {
		const { accountConfigId, event } = anAccount();
		const calendar = await client.calendarCollection.create({
			accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});
		const card = await putSuggestion(accountConfigId, "msg-edited-declined");
		await client.calendarSuggestion.settle(accountConfigId, card.suggestionId, {
			state: CalendarSuggestionState.Declined,
			acceptedCalendarObjectId: "",
		});

		await assert.rejects(
			() =>
				acceptSuggestion(
					contextOf({
						params: { suggestionId: card.suggestionId },
						requestBody: {
							calendarId: calendar.calendarId,
							event: { summary: "Quarterly review, moved" },
						},
					}),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 400,
		);
		assert.deepEqual(
			await client.calendarObject.listByCalendar(calendar.calendarId),
			[],
		);
	});
});

describe("POST /calendar-suggestions/{suggestionId}/reopen", () => {
	const answeredInto = async (
		accountConfigId: string,
		messageId: string,
		answer: (typeof CalendarInviteAnswer)[keyof typeof CalendarInviteAnswer],
	): Promise<{ calendarId: string; card: CalendarSuggestionItem }> => {
		const calendar = await client.calendarCollection.create({
			accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});
		const accepted = await acceptCalendarSuggestion(client.calendarUnitOfWork, {
			accountConfigId,
			calendarId: calendar.calendarId,
			suggestion: await putSuggestion(accountConfigId, messageId),
			attendee: "user@example.test",
			answer,
		});
		assert.ok(accepted.ok);
		return { calendarId: calendar.calendarId, card: accepted.value.suggestion };
	};

	for (const answer of [
		CalendarInviteAnswer.Accepted,
		CalendarInviteAnswer.Tentative,
	]) {
		test(`takes a ${answer} answer back and removes the event it wrote`, async () => {
			const { accountConfigId, event } = anAccount();
			const { calendarId, card } = await answeredInto(
				accountConfigId,
				`msg-reopen-${answer}`,
				answer,
			);
			assert.equal(
				(await client.calendarObject.listByCalendar(calendarId)).length,
				1,
			);

			const reopened = (await reopenSuggestion(
				contextOf({ params: { suggestionId: card.suggestionId } }),
				event,
			)) as unknown as CalendarSuggestionItem;

			assert.equal(reopened.state, CalendarSuggestionState.Pending);
			assert.equal(reopened.acceptedCalendarObjectId, "");
			assert.deepEqual(
				await client.calendarObject.listByCalendar(calendarId),
				[],
			);
			const stored = await client.calendarSuggestion.get(
				accountConfigId,
				card.suggestionId,
			);
			assert.equal(stored.state, CalendarSuggestionState.Pending);
		});
	}

	for (const state of [
		CalendarSuggestionState.Declined,
		CalendarSuggestionState.Dismissed,
	]) {
		test(`returns a ${state} card to Pending`, async () => {
			const { accountConfigId, event } = anAccount();
			const card = await putSuggestion(accountConfigId, `msg-reopen-${state}`);
			await client.calendarSuggestion.settle(
				accountConfigId,
				card.suggestionId,
				{ state, acceptedCalendarObjectId: "" },
			);

			const reopened = (await reopenSuggestion(
				contextOf({ params: { suggestionId: card.suggestionId } }),
				event,
			)) as unknown as Card;

			assert.equal(reopened.state, CalendarSuggestionState.Pending);
		});
	}

	test("refuses a superseded card and leaves it as it is", async () => {
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-reopen-superseded");
		await client.calendarSuggestion.supersedeIfPending(
			accountConfigId,
			card.suggestionId,
			"msg-reopen-newer",
		);

		await assert.rejects(
			() =>
				reopenSuggestion(
					contextOf({ params: { suggestionId: card.suggestionId } }),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 400,
		);

		const untouched = await client.calendarSuggestion.get(
			accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Superseded);
	});

	test("refuses a cancellation, whose answer it cannot undo", async () => {
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(
			accountConfigId,
			"msg-reopen-cancel",
			CalendarInviteMethod.Cancel,
		);
		await client.calendarSuggestion.settle(accountConfigId, card.suggestionId, {
			state: CalendarSuggestionState.Dismissed,
			acceptedCalendarObjectId: "",
		});

		await assert.rejects(
			() =>
				reopenSuggestion(
					contextOf({ params: { suggestionId: card.suggestionId } }),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 400,
		);
	});

	test("answers not-found for a card on another account", async () => {
		const stranger = anAccount();
		const { card } = await answeredInto(
			stranger.accountConfigId,
			"msg-reopen-stranger",
			CalendarInviteAnswer.Accepted,
		);
		const { event } = anAccount();

		await assert.rejects(
			() =>
				reopenSuggestion(
					contextOf({ params: { suggestionId: card.suggestionId } }),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 404,
		);
		const untouched = await client.calendarSuggestion.get(
			stranger.accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Accepted);
	});
});

describe("POST /calendar-suggestions/{suggestionId}/reopen, against what else holds the event", () => {
	const recurring = (sequence: number): string =>
		INVITATION.replace(
			"SUMMARY:Quarterly review",
			`SEQUENCE:${sequence}\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nSUMMARY:Quarterly review`,
		);

	const putInvite = (
		accountConfigId: string,
		messageId: string,
		sequence: number,
	): Promise<CalendarSuggestionItem> =>
		client.calendarSuggestion.put({
			accountConfigId,
			messageId,
			bodyPartId: "part-1",
			icalUid: "invite@example.test",
			sequence,
			method: CalendarInviteMethod.Request,
			source: CalendarSuggestionSource.IcalendarPart,
			summary: "Quarterly review",
			dtStart: "2026-09-01T10:00:00+02:00",
			dtEnd: "2026-09-01T11:00:00+02:00",
			allDay: false,
			location: "Room 4",
			organizer: "organizer@example.test",
			zoneCertainty: "Explicit",
			icalData: recurring(sequence),
		} as PutCalendarSuggestionInput);

	const acceptInto = async (
		accountConfigId: string,
		calendarId: string,
		suggestion: CalendarSuggestionItem,
	): Promise<CalendarSuggestionItem> => {
		const accepted = await acceptCalendarSuggestion(client.calendarUnitOfWork, {
			accountConfigId,
			calendarId,
			suggestion,
			attendee: "user@example.test",
			answer: CalendarInviteAnswer.Accepted,
		});
		assert.ok(accepted.ok);
		return accepted.value.suggestion;
	};

	const calendarOf = (accountConfigId: string) =>
		client.calendarCollection.create({
			accountConfigId,
			urlSegment: "default",
			displayName: "Calendar",
		});

	test("refuses a request's answer once its cancellation was answered into the event, and says so on the card", async () => {
		const { accountConfigId, event } = anAccount();
		const calendar = await calendarOf(accountConfigId);
		const first = await acceptInto(
			accountConfigId,
			calendar.calendarId,
			await putInvite(accountConfigId, "msg-overtaken-0", 0),
		);
		await acceptInto(
			accountConfigId,
			calendar.calendarId,
			await putSuggestion(
				accountConfigId,
				"msg-overtaken-cancel",
				CalendarInviteMethod.Cancel,
			),
		);

		await assert.rejects(
			() =>
				reopenSuggestion(
					contextOf({ params: { suggestionId: first.suggestionId } }),
					event,
				),
			(error: unknown) => (error as { statusCode?: number }).statusCode === 400,
		);

		assert.equal(
			(await client.calendarObject.listByCalendar(calendar.calendarId)).length,
			1,
		);
		const listed = (await listMessageSuggestions(
			contextOf({ params: { messageId: "msg-overtaken-0" } }),
			event,
		)) as unknown as { items: { answerOvertakenBy: string }[] };
		assert.deepEqual(
			listed.items.map((item) => item.answerOvertakenBy),
			[CalendarAnswerOvertaken.Cancellation],
		);
	});

	test("takes back both halves of a this-and-following split, and a re-add writes one event", async () => {
		const { accountConfigId, event } = anAccount();
		const calendar = await calendarOf(accountConfigId);
		const card = await acceptInto(
			accountConfigId,
			calendar.calendarId,
			await putInvite(accountConfigId, "msg-split", 0),
		);
		const split = await updateCalendarEventFor(
			calendarEventDepsOf(calendarDepsOf(client)),
			accountConfigId,
			{
				calendarId: calendar.calendarId,
				calendarObjectId: card.acceptedCalendarObjectId,
				scope: RecurrenceScope.Following,
				recurrenceId: "2026-09-15T08:00:00Z",
				ifMatch: undefined,
			},
			{ summary: "Quarterly review (moved)" },
		);
		assert.ok(split.ok, JSON.stringify(split));
		assert.equal(
			(await client.calendarObject.listByCalendar(calendar.calendarId)).length,
			2,
		);

		const reopened = (await reopenSuggestion(
			contextOf({ params: { suggestionId: card.suggestionId } }),
			event,
		)) as unknown as CalendarSuggestionItem;

		assert.equal(reopened.state, CalendarSuggestionState.Pending);
		assert.deepEqual(
			await client.calendarObject.listByCalendar(calendar.calendarId),
			[],
		);
		await acceptInto(accountConfigId, calendar.calendarId, {
			...card,
			...reopened,
		});
		assert.equal(
			(await client.calendarObject.listByCalendar(calendar.calendarId)).length,
			1,
		);
	});

	test("keeps the sender rule a mute wrote", async () => {
		const { accountConfigId, event } = anAccount();
		const card = await putSuggestion(accountConfigId, "msg-mute-reopen");
		await seedMessageFrom("msg-mute-reopen", "organizer@example.test");
		await dismissSuggestion(
			contextOf({
				params: { suggestionId: card.suggestionId },
				requestBody: { muteSender: true },
			}),
			event,
		);

		const reopened = (await reopenSuggestion(
			contextOf({ params: { suggestionId: card.suggestionId } }),
			event,
		)) as unknown as Card;

		assert.equal(reopened.state, CalendarSuggestionState.Pending);
		const rules = await client.filter.listByAccountAndState(
			accountConfigId,
			FilterState.Active,
		);
		assert.deepEqual(
			rules.map((rule) => rule.literalClauses),
			[[{ field: "From", value: "organizer@example.test" }]],
		);
	});

	test("a delete that fails part-way leaves the event and the answer as they were", async () => {
		const { accountConfigId } = anAccount();
		const calendar = await calendarOf(accountConfigId);
		const card = await acceptInto(
			accountConfigId,
			calendar.calendarId,
			await putInvite(accountConfigId, "msg-rollback", 0),
		);
		const failing: ICalendarUnitOfWork = {
			transaction: (fn) =>
				client.calendarUnitOfWork.transaction((repos) =>
					fn({
						...repos,
						calendarCollection: Object.assign(
							Object.create(repos.calendarCollection),
							{
								bumpSyncSequence: async () => {
									throw new Error("disk full");
								},
							},
						),
					}),
				),
		};

		await assert.rejects(
			() =>
				reopenCalendarSuggestion(failing, {
					accountConfigId,
					suggestion: card,
				}),
			/disk full/,
		);

		const object = await client.calendarObject.find(
			calendar.calendarId,
			card.acceptedCalendarObjectId,
		);
		assert.ok(object, "the event is still on the calendar");
		assert.ok(
			(
				await client.calendarEventIndex.listForObject(
					calendar.calendarId,
					card.acceptedCalendarObjectId,
				)
			).length > 0,
			"and so are its occurrences",
		);
		const untouched = await client.calendarSuggestion.get(
			accountConfigId,
			card.suggestionId,
		);
		assert.equal(untouched.state, CalendarSuggestionState.Accepted);
		assert.equal(
			untouched.acceptedCalendarObjectId,
			card.acceptedCalendarObjectId,
		);
	});
});
