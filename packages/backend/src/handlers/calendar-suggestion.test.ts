import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type {
	CalendarSuggestionItem,
	CreateFilterInput,
	FilterItem,
	ICalendarSuggestionRepository,
	MessageData,
	PutCalendarSuggestionInput,
	ResultList,
	SettleCalendarSuggestionInput,
} from "@remit/data-ports";
import {
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
	FilterState,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import {
	assertSettleable,
	CalendarSuggestionActionOperations,
	CalendarSuggestionOperations,
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
		const response = toCalendarSuggestionResponse(suggestion());

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

interface Card {
	suggestionId: string;
	state: string;
}

let client: RemitClient;
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
): Promise<CalendarSuggestionItem> =>
	client.calendarSuggestion.put({
		accountConfigId,
		messageId,
		bodyPartId: "part-1",
		icalUid: "invite@example.test",
		sequence: 0,
		method: CalendarInviteMethod.Request,
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
	client = await createCalendarSqliteClient();
	setClient(client);
});

after(() => {
	_resetForTest();
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
