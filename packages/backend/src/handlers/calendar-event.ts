import type {
	CalendarEventInstance,
	CalendarEventResponse,
	CalendarFreeBusySpan,
	CalendarInviteAnswer,
	CalendarSchedulingSend,
	CreateCalendarEventInput,
	UpdateCalendarEventInput,
} from "@remit/api-openapi-types";
import {
	applyAnswer,
	applyGuestList,
	applyScopedDelete,
	applyScopedUpdate,
	attendeesOf,
	buildEventCalendar,
	bumpSequence,
	type CalendarEventFields,
	type CalendarInstance,
	type CalendarPerson,
	type CalendarWindow,
	calendarAddressOf,
	countAttendees,
	deleteCalendarObject,
	distinctGuests,
	followingUidOf,
	guestAddressesOf,
	invalidGuestOf,
	listBusySpans,
	listCalendarInstances,
	listObjectInstances,
	OFFSET_BEARING,
	organizerOf,
	type ParsedCalendar,
	parseCalendar,
	participationOf,
	prepareCalendarObject,
	putCalendarObject,
	type RecurrenceScopeValue,
	readWrittenObject,
	type ScopedWrite,
	selfAddressSet,
	toOffsetIso,
	toUtcIso,
} from "@remit/calendar-service";
import type {
	AccountItem,
	CalendarCollectionItem,
	CalendarObjectItem,
	PutCalendarObjectWrite,
} from "@remit/data-ports";
import { base36uuid } from "@remit/data-ports/id";
import {
	CalendarComponentSet,
	CalendarInviteMethod,
	CalendarParticipation,
	CalendarSuggestionState,
	RecurrenceScope,
} from "@remit/domain-enums";
import type {
	CalendarEventDetailOperationIds,
	CalendarEventOperationIds,
	CalendarFreeBusyOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
import {
	badRequest,
	type CalendarDeps,
	type CalendarOutcome,
	calendarDepsOf,
	findCalendarFor,
	findWritableCalendarFor,
	listCalendarsFor,
	notFound,
	preconditionFailed,
	refuseCalendar,
	selfAddressesFor,
} from "./calendar.js";
import {
	type CalendarScheduling,
	calendarSchedulingOf,
	planDeleteFanOut,
	planGuestFanOut,
	queueSchedulingSends,
	type SchedulingSendPlan,
	sendsMail,
} from "./calendar-scheduling.js";

/**
 * The widest window a single read may ask for. A year covers every view the
 * client has — a year grid is the coarsest — and keeps one request from asking
 * the server to expand a decade of a daily series.
 */
export const CALENDAR_MAX_WINDOW_DAYS = 366;

const MAX_WINDOW_MS = CALENDAR_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Mints the id a new resource is named and identified by. */
export interface CalendarEventDeps extends CalendarDeps {
	newId: () => string;
	now: () => Date;
	scheduling: CalendarScheduling;
}

export const calendarEventDepsOf = (
	deps: CalendarDeps,
	scheduling: CalendarScheduling,
): CalendarEventDeps => ({
	...deps,
	newId: base36uuid,
	now: () => new Date(),
	scheduling,
});

/**
 * Reads the window a listing asked for.
 *
 * Both ends must carry an offset, because a window with no offset names no
 * span of time — and a client whose `from` was read an hour out gets an
 * apparently empty morning rather than an error.
 */
export const readWindow = (
	from: unknown,
	to: unknown,
): CalendarOutcome<CalendarWindow> => {
	if (typeof from !== "string" || typeof to !== "string") {
		return refuseCalendar(
			"InvalidWindow",
			"a listing needs both `from` and `to`",
		);
	}
	const fromMs = Date.parse(from);
	const toMs = Date.parse(to);
	if (
		Number.isNaN(fromMs) ||
		Number.isNaN(toMs) ||
		!OFFSET_BEARING.test(from) ||
		!OFFSET_BEARING.test(to)
	) {
		return refuseCalendar(
			"InvalidWindow",
			"`from` and `to` must be ISO 8601 date-times with a zone offset",
		);
	}
	if (toMs <= fromMs) {
		return refuseCalendar("InvalidWindow", "`to` must come after `from`");
	}
	if (toMs - fromMs > MAX_WINDOW_MS) {
		return refuseCalendar(
			"InvalidWindow",
			`a window may cover at most ${CALENDAR_MAX_WINDOW_DAYS} days`,
		);
	}
	return { ok: true, value: { from: toUtcIso(fromMs), to: toUtcIso(toMs) } };
};

/**
 * The collections a listing covers, defaulting to every one the caller holds
 * of the component set asked for.
 */
export const collectionsForListing = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarIds: string[],
	componentSet: CalendarCollectionItem["componentSet"] = CalendarComponentSet.VeventOnly,
): Promise<CalendarOutcome<CalendarCollectionItem[]>> => {
	const held = await listCalendarsFor(deps, accountConfigId);
	if (calendarIds.length === 0) {
		return {
			ok: true,
			value: held.filter(
				(collection) => collection.componentSet === componentSet,
			),
		};
	}

	const selected = held.filter((collection) =>
		calendarIds.includes(collection.calendarId),
	);
	const missing = calendarIds.find(
		(calendarId) =>
			!held.some((collection) => collection.calendarId === calendarId),
	);
	if (missing) {
		return refuseCalendar("NotFound", `no calendar ${missing} on this account`);
	}
	return { ok: true, value: selected };
};

const toInstanceResponse = (
	instance: CalendarInstance,
): CalendarEventInstance => ({
	calendarId: instance.calendarId,
	calendarObjectId: instance.calendarObjectId,
	recurrenceId: instance.recurrenceId,
	icalUid: instance.icalUid,
	summary: instance.summary,
	start: instance.start,
	end: instance.end,
	allDay: instance.allDay,
	status: instance.status,
	transparency: instance.transparency,
	zoneCertainty: instance.zoneCertainty,
	etag: instance.etag,
	hasRecurrence: instance.hasRecurrence,
	participation: instance.participation,
});

const parsedOrThrow = async (
	object: Pick<CalendarObjectItem, "calendarObjectId" | "icalData">,
): Promise<ParsedCalendar> => {
	const parsed = await parseCalendar(object.icalData);
	if (!parsed.ok) {
		throw new Error(
			`stored calendar object ${object.calendarObjectId} no longer parses: ${parsed.error.message}`,
		);
	}
	return parsed.value;
};

/** The scheduling messages about an event still in the outbox. */
const pendingSends = async (
	scheduling: CalendarScheduling,
	calendarObjectId: string,
): Promise<CalendarSchedulingSend[]> =>
	(await scheduling.pending(calendarObjectId)).map(({ part, row }) => ({
		email: part.recipient,
		outboxMessageId: row.outboxMessageId,
		method: part.method as CalendarSchedulingSend["method"],
		status: row.status,
	}));

/**
 * An event as the API returns it: the stored row, plus the guest list read
 * from its bytes and the reader's own place on it.
 */
export const toEventResponse = async (
	object: CalendarObjectItem,
	self: ReadonlySet<string>,
	sends: CalendarSchedulingSend[],
): Promise<CalendarEventResponse> => {
	const { master } = await parsedOrThrow(object);
	const attendees = attendeesOf(master);
	return {
		calendarObjectId: object.calendarObjectId,
		calendarId: object.calendarId,
		resourceName: object.resourceName,
		icalUid: object.icalUid,
		icalData: object.icalData,
		etag: object.etag,
		sequence: object.sequence,
		syncSequence: object.syncSequence,
		summary: object.summary,
		dtStart: object.dtStart,
		dtEnd: object.dtEnd,
		allDay: object.allDay,
		zoneCertainty: object.zoneCertainty,
		status: object.status,
		transparency: object.transparency,
		hasRecurrence: object.hasRecurrence,
		expandedThrough: object.expandedThrough,
		createdAt: object.createdAt,
		updatedAt: object.updatedAt,
		participation: participationOf(master, self),
		organizer: organizerOf(master),
		attendees,
		attendeeCounts: countAttendees(attendees),
		sends,
	};
};

const eventFieldsOf = (
	input: CreateCalendarEventInput,
): CalendarEventFields => ({
	summary: input.summary,
	description: input.description ?? "",
	location: input.location ?? "",
	start: input.start,
	end: input.end,
	allDay: input.allDay ?? false,
	timeZone: input.timeZone ?? "",
	status: input.status ?? "Confirmed",
	transparency: input.transparency ?? "Opaque",
	recurrenceRule: input.recurrenceRule ?? "",
});

/**
 * Reduce a PATCH body to the event fields an update may set, preserving
 * absence: a body carrying only `summary` yields only `summary`, and the
 * resource's times are then left exactly as they were.
 */
export const pickEventUpdate = (
	body: Partial<UpdateCalendarEventInput>,
): Partial<CalendarEventFields> => {
	const patch: Partial<CalendarEventFields> = {};
	const fields = [
		"summary",
		"description",
		"location",
		"start",
		"end",
		"allDay",
		"timeZone",
		"status",
		"transparency",
		"recurrenceRule",
	] as const;
	for (const field of fields) {
		if (!Object.hasOwn(body, field)) continue;
		Object.assign(patch, { [field]: body[field] });
	}
	return patch;
};

/** The scheduling half of a PATCH body: the guest list, the organizer and an answer. */
export interface EventSchedulingUpdate {
	attendees?: CalendarPerson[];
	organizerAccountId?: string;
	answer?: CalendarInviteAnswer;
}

export const pickSchedulingUpdate = (
	body: Partial<UpdateCalendarEventInput>,
): EventSchedulingUpdate => ({
	...(body.attendees !== undefined && { attendees: body.attendees }),
	...(body.organizerAccountId !== undefined && {
		organizerAccountId: body.organizerAccountId,
	}),
	...(body.answer !== undefined && { answer: body.answer }),
});

/**
 * Whether an `If-Match` header lets the write through.
 *
 * No header is no precondition, which is what HTTP says and what a first-party
 * client that just read the resource wants. `*` matches any existing resource.
 * Quotes and a weak-validator prefix are transport spelling and are stripped
 * before comparing, because the stored tag carries neither.
 */
export const etagMatches = (
	ifMatch: string | undefined,
	etag: string,
): boolean => {
	if (ifMatch === undefined || ifMatch === "") return true;
	return ifMatch
		.split(",")
		.map((candidate) => candidate.trim().replace(/^W\//, "").replace(/"/g, ""))
		.some((candidate) => candidate === "*" || candidate === etag);
};

/**
 * An absent scope means the whole series, which is what a client editing an
 * event that does not recur sends. A scope that is present but not one of the
 * three is refused rather than read as `All`: the widest, most destructive
 * reading is the worst possible answer to a typo.
 */
export const readScope = (
	value: unknown,
): CalendarOutcome<RecurrenceScopeValue> => {
	if (value === undefined || value === "") {
		return { ok: true, value: RecurrenceScope.All };
	}
	if (
		value === RecurrenceScope.This ||
		value === RecurrenceScope.Following ||
		value === RecurrenceScope.All
	) {
		return { ok: true, value };
	}
	return refuseCalendar(
		"InvalidScope",
		`scope must be one of This, Following or All, and this request sent "${String(value)}"`,
	);
};

/** The resources a scoped write stores, prepared and not yet committed. */
interface PreparedWrite {
	kind: ScopedWrite["kind"];
	puts: PutCalendarObjectWrite[];
}

/**
 * Turns what a scoped edit resolved to into the store writes it is.
 *
 * Both halves of a split are prepared before either is written, so a refusal
 * of either one commits nothing: half a split is never stored.
 */
const prepareScopedWrite = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	object: CalendarObjectItem,
	collectionTimezone: string,
	selfAddresses: readonly string[],
	write: ScopedWrite,
): Promise<CalendarOutcome<PreparedWrite>> => {
	if (write.kind === "Delete")
		return { ok: true, value: { kind: "Delete", puts: [] } };
	const zone = { timezone: collectionTimezone };
	const head = await prepareCalendarObject(zone, {
		accountConfigId,
		calendarId: object.calendarId,
		resourceName: object.resourceName,
		icalData: write.icalData,
		selfAddresses,
	});
	if (!head.ok) return head;
	if (write.kind === "Replace") {
		return { ok: true, value: { kind: "Replace", puts: [head.value] } };
	}
	const following = await prepareCalendarObject(zone, {
		accountConfigId,
		calendarId: object.calendarId,
		resourceName: `${deps.newId()}.ics`,
		icalData: write.following,
		selfAddresses,
	});
	if (!following.ok) return following;
	return {
		ok: true,
		value: { kind: "Split", puts: [head.value, following.value] },
	};
};

/**
 * Writes what a scoped edit resolved to.
 *
 * A split is two resources and one write set: the truncated original and the
 * remainder land together or not at all, because half a split is a series the
 * user sees twice or not at all.
 */
export const commitScopedWrite = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	object: CalendarObjectItem,
	collectionTimezone: string,
	write: ScopedWrite,
): Promise<CalendarOutcome<CalendarObjectItem | null>> => {
	const prepared = await prepareScopedWrite(
		deps,
		accountConfigId,
		object,
		collectionTimezone,
		await selfAddressesFor(deps, accountConfigId),
		write,
	);
	if (!prepared.ok) return prepared;
	const written = await commitPrepared(
		deps,
		accountConfigId,
		object,
		prepared.value,
	);
	return { ok: true, value: written.at(-1) ?? null };
};

/**
 * Commits a prepared write and reads back what it stored, in write order. The
 * last one is what the patch applied to: for a split, the remainder, under an
 * id the caller has never seen.
 */
const commitPrepared = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	object: CalendarObjectItem,
	prepared: PreparedWrite,
): Promise<CalendarObjectItem[]> => {
	if (prepared.kind === "Delete") {
		await deleteCalendarObject(deps.calendarStore, {
			accountConfigId,
			calendarId: object.calendarId,
			calendarObjectId: object.calendarObjectId,
		});
		return [];
	}
	await deps.calendarStore.commit(prepared.puts);
	const written: CalendarObjectItem[] = [];
	for (const put of prepared.puts) {
		written.push(await readWrittenObject(deps.calendarStore, put));
	}
	return written;
};

/** An event write, and the scheduling messages it queued. */
export interface ScheduledWrite<T> {
	object: T;
	sends: CalendarSchedulingSend[];
}

const accountOf = (
	accounts: readonly AccountItem[],
	accountId: string,
): AccountItem | undefined =>
	accounts.find((account) => account.accountId === accountId);

const accountByAddress = (
	accounts: readonly AccountItem[],
	address: string,
): AccountItem | undefined =>
	accounts.find((account) => account.email.toLowerCase() === address);

/**
 * The account that sends for an event, refused before anything is written
 * when it cannot: a guest list with nobody able to send to it is a save that
 * would tell the person their guests were invited when none were.
 */
const sendingAccount = (
	accounts: readonly AccountItem[],
	accountId: string,
): CalendarOutcome<AccountItem> => {
	const account = accountOf(accounts, accountId);
	if (!account) {
		return refuseCalendar(
			"UnknownOrganizer",
			`no account ${accountId} on this account config to send the invitations from`,
		);
	}
	if (!sendsMail(account)) {
		return refuseCalendar(
			"OrganizerCannotSend",
			`${account.email} has Mail turned off, so it cannot send invitations. Turn Mail on for it in Settings, or send from another account.`,
		);
	}
	return { ok: true, value: account };
};

const guestListOf = (
	organizer: string,
	attendees: readonly CalendarPerson[],
): CalendarOutcome<CalendarPerson[]> => {
	const invalid = invalidGuestOf(attendees);
	if (invalid) {
		return refuseCalendar(
			"InvalidGuest",
			`"${invalid.email}" is not a mail address, so no invitation can go to it`,
		);
	}
	return { ok: true, value: distinctGuests(organizer, attendees) };
};

const personOf = (
	guests: readonly CalendarPerson[],
	email: string,
): CalendarPerson =>
	guests.find((guest) => guest.email === email) ?? { email, displayName: "" };

const guestPeopleOf = (calendar: ParsedCalendar): CalendarPerson[] =>
	attendeesOf(calendar.master)
		.filter((attendee) => attendee.role === "Guest")
		.map((attendee) => ({
			email: attendee.email,
			displayName: attendee.displayName,
		}));

export const createCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	input: CreateCalendarEventInput,
): Promise<CalendarOutcome<ScheduledWrite<CalendarObjectItem>>> => {
	const collection = await findWritableCalendarFor(
		deps,
		accountConfigId,
		input.calendarId,
	);
	if (!collection.ok) return collection;

	const accounts = await deps.scheduling.accounts();
	const selfAddresses = accounts.map((account) => account.email);
	const requested = input.attendees ?? [];

	let organizer: AccountItem | undefined;
	let guests: CalendarPerson[] = [];
	if (requested.length > 0) {
		const from = sendingAccount(accounts, input.organizerAccountId);
		if (!from.ok) return from;
		organizer = from.value;
		const listed = guestListOf(organizer.email, requested);
		if (!listed.ok) return listed;
		guests = listed.value;
	}

	const id = deps.newId();
	const built = await buildEventCalendar(
		eventFieldsOf(input),
		`${id}@reader.remit`,
		deps.now(),
	);
	if (!built.ok) return built;
	const icalData =
		organizer && guests.length > 0
			? await applyGuestList(
					built.value,
					{ email: organizer.email, displayName: "" },
					guests,
				)
			: built.value;

	const stored = await putCalendarObject(deps.calendarStore, {
		accountConfigId,
		calendarId: collection.value.calendarId,
		resourceName: `${id}.ics`,
		icalData,
		selfAddresses,
	});
	if (!stored.ok) return stored;
	if (!organizer || guests.length === 0) {
		return { ok: true, value: { object: stored.value, sends: [] } };
	}

	const sends = await queueSchedulingSends(
		deps.scheduling,
		accountConfigId,
		organizer,
		guests.map((guest) => ({
			method: CalendarInviteMethod.Request,
			calendarObjectId: stored.value.calendarObjectId,
			icalData: stored.value.icalData,
			collectionTimezone: collection.value.timezone,
			recipient: guest,
			attendee: guest,
			recurrenceId: "",
		})),
	);
	return { ok: true, value: { object: stored.value, sends } };
};

export interface ScopedRequest {
	calendarId: string;
	calendarObjectId: string;
	scope: RecurrenceScopeValue;
	recurrenceId: string;
	ifMatch: string | undefined;
}

interface ResolvedResource {
	collection: CalendarCollectionItem;
	object: CalendarObjectItem;
}

const resolveResource = async (
	deps: CalendarDeps,
	accountConfigId: string,
	request: Pick<ScopedRequest, "calendarId" | "calendarObjectId">,
	intent: "read" | "write",
): Promise<CalendarOutcome<ResolvedResource>> => {
	const collection =
		intent === "write"
			? await findWritableCalendarFor(deps, accountConfigId, request.calendarId)
			: await findCalendarFor(deps, accountConfigId, request.calendarId);
	if (!collection.ok) return collection;

	const object = await deps.calendarObject.find(
		request.calendarId,
		request.calendarObjectId,
	);
	if (!object) {
		return refuseCalendar(
			"NotFound",
			`no event ${request.calendarObjectId} in this calendar`,
		);
	}
	return { ok: true, value: { collection: collection.value, object } };
};

const touchesSchedule = (patch: Partial<CalendarEventFields>): boolean =>
	patch.start !== undefined ||
	patch.end !== undefined ||
	patch.allDay !== undefined ||
	patch.timeZone !== undefined ||
	patch.recurrenceRule !== undefined;

const SUGGESTION_STATE_OF: Record<
	CalendarInviteAnswer,
	(typeof CalendarSuggestionState)[keyof typeof CalendarSuggestionState]
> = {
	Accepted: CalendarSuggestionState.Accepted,
	Tentative: CalendarSuggestionState.Tentative,
	Declined: CalendarSuggestionState.Declined,
};

/**
 * A card whose answer wrote this event follows a later answer given on the
 * event, so the mail and the calendar never disagree about what was said.
 */
const settleAnsweredSuggestions = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	calendarObjectId: string,
	answer: CalendarInviteAnswer,
): Promise<void> => {
	const cards =
		await deps.calendarStore.repos.calendarSuggestion.listByAcceptedCalendarObjects(
			accountConfigId,
			[calendarObjectId],
		);
	if (cards.length === 0) return;
	await deps.calendarStore.commit(
		cards.map((card) => ({
			kind: "SettleSuggestion" as const,
			accountConfigId,
			suggestionId: card.suggestionId,
			settle: {
				state: SUGGESTION_STATE_OF[answer],
				acceptedCalendarObjectId: calendarObjectId,
			},
		})),
	);
};

/** The organizer an update writes with, when the patch carries a guest list. */
const organizerForUpdate = async (
	deps: CalendarEventDeps,
	accounts: readonly AccountItem[],
	self: ReadonlySet<string>,
	stored: string,
	requestedAccountId: string | undefined,
): Promise<CalendarOutcome<AccountItem>> => {
	if (stored !== "") {
		if (!self.has(stored)) {
			return refuseCalendar(
				"NotOrganizer",
				`${stored} organizes this event, so only they can change its guests`,
			);
		}
		const own = accountByAddress(accounts, stored);
		if (!own) {
			return refuseCalendar(
				"NotOrganizer",
				`${stored} organizes this event and is not an account here`,
			);
		}
		if (
			requestedAccountId !== undefined &&
			requestedAccountId !== own.accountId
		) {
			return refuseCalendar(
				"NotOrganizer",
				`${stored} organizes this event; the organizer of an event never changes`,
			);
		}
		return sendingAccount(accounts, own.accountId);
	}
	const chosen =
		requestedAccountId ??
		((await deps.scheduling.defaultOrganizerAccountId()) ||
			accounts[0]?.accountId ||
			"");
	return sendingAccount(accounts, chosen);
};

/**
 * Edits an event, and queues what the edit owes its guests.
 *
 * The calendar row is local truth and is written first. The outbox rows are
 * the pending records of the messages that follow it: an invitation to every
 * guest of an event the reader organizes, a cancellation to a guest the edit
 * removed, a reply to the organizer when the reader answers as a guest. A
 * later edit made while an earlier message is still queued does not wait for
 * it: each message carries the SEQUENCE of the bytes it was built from, and a
 * recipient keeps the highest.
 */
export const updateCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	request: ScopedRequest,
	patch: Partial<CalendarEventFields>,
	scheduling: EventSchedulingUpdate = {},
): Promise<CalendarOutcome<ScheduledWrite<CalendarObjectItem | null>>> => {
	const resolved = await resolveResource(
		deps,
		accountConfigId,
		request,
		"write",
	);
	if (!resolved.ok) return resolved;
	const { collection, object } = resolved.value;

	if (!etagMatches(request.ifMatch, object.etag)) {
		return refuseCalendar(
			"EtagMismatch",
			"this event has been written since you read it — read it again and reapply the change",
		);
	}

	const parsed = await parsedOrThrow(object);
	const accounts = await deps.scheduling.accounts();
	const selfAddresses = accounts.map((account) => account.email);
	const self = selfAddressSet(selfAddresses);
	const storedOrganizer = organizerOf(parsed.master);
	const previousGuests = guestPeopleOf(parsed);
	const participation = participationOf(parsed.master, self);

	let answeringAs = "";
	if (scheduling.answer !== undefined) {
		if (request.scope === RecurrenceScope.Following) {
			return refuseCalendar(
				"InvalidScope",
				"an answer is to one occurrence (This) or to the series (All), never to the rest of it",
			);
		}
		if (
			participation === CalendarParticipation.Organizer ||
			participation === CalendarParticipation.Unscheduled
		) {
			return refuseCalendar(
				"NotAGuest",
				"you are not a guest of this event, so there is no invitation to answer",
			);
		}
		answeringAs =
			parsed.master
				.getAllProperties("attendee")
				.map((line) => calendarAddressOf(line.getFirstValue()))
				.find((address) => self.has(address)) ?? "";
	}

	let organizer: AccountItem | undefined;
	let guests = previousGuests;
	if (scheduling.attendees !== undefined) {
		const chosen = await organizerForUpdate(
			deps,
			accounts,
			self,
			storedOrganizer,
			scheduling.organizerAccountId,
		);
		if (!chosen.ok) return chosen;
		organizer = chosen.value;
		const listed = guestListOf(organizer.email, scheduling.attendees);
		if (!listed.ok) return listed;
		guests = listed.value;
	} else if (self.has(storedOrganizer) && previousGuests.length > 0) {
		const own = accountByAddress(accounts, storedOrganizer);
		if (own) {
			const from = sendingAccount(accounts, own.accountId);
			if (!from.ok) return from;
			organizer = from.value;
		}
	}

	const write = await applyScopedUpdate(
		parsed,
		collection.timezone,
		{
			scope: request.scope,
			recurrenceId: request.recurrenceId,
			followingUid: followingUidOf(
				object.icalUid,
				`${deps.newId()}@reader.remit`,
			),
		},
		patch,
	);
	if (!write.ok) return write;
	if (write.value.kind === "Delete") {
		throw new Error("a scoped update resolved to a delete");
	}

	const organized =
		organizer !== undefined && guests.length + previousGuests.length > 0;
	const reschedules = organized && touchesSchedule(patch);
	const finish = async (
		icalData: string,
		patched: boolean,
	): Promise<string> => {
		let next = icalData;
		if (patched && organizer && scheduling.attendees !== undefined) {
			next = await applyGuestList(
				next,
				{ email: organizer.email, displayName: "" },
				guests,
			);
		}
		if (reschedules) next = await bumpSequence(next);
		return next;
	};

	let finished: ScopedWrite =
		write.value.kind === "Split"
			? {
					kind: "Split",
					icalData: await finish(write.value.icalData, false),
					following: await finish(write.value.following, true),
				}
			: { kind: "Replace", icalData: await finish(write.value.icalData, true) };

	if (scheduling.answer !== undefined && finished.kind === "Replace") {
		const answered = await applyAnswer(
			finished.icalData,
			collection.timezone,
			answeringAs,
			scheduling.answer,
			request.scope === RecurrenceScope.This ? request.recurrenceId : "",
		);
		if (!answered.ok) return answered;
		finished = { kind: "Replace", icalData: answered.value };
	}

	const prepared = await prepareScopedWrite(
		deps,
		accountConfigId,
		object,
		collection.timezone,
		selfAddresses,
		finished,
	);
	if (!prepared.ok) return prepared;
	const written = await commitPrepared(
		deps,
		accountConfigId,
		object,
		prepared.value,
	);
	const result = written.at(-1) ?? null;
	if (
		scheduling.answer !== undefined &&
		request.scope === RecurrenceScope.All &&
		result
	) {
		await settleAnsweredSuggestions(
			deps,
			accountConfigId,
			result.calendarObjectId,
			scheduling.answer,
		);
	}

	const plans: SchedulingSendPlan[] = [];
	let from: AccountItem | undefined;
	if (organized && organizer) {
		from = organizer;
		const fanOut = planGuestFanOut(
			previousGuests.map((guest) => guest.email),
			guests.map((guest) => guest.email),
		);
		for (const resource of written) {
			const current = guestAddressesOf(await parsedOrThrow(resource));
			for (const email of fanOut.request.filter((guest) =>
				current.includes(guest),
			)) {
				const person = personOf(guests, email);
				plans.push({
					method: CalendarInviteMethod.Request,
					calendarObjectId: resource.calendarObjectId,
					icalData: resource.icalData,
					collectionTimezone: collection.timezone,
					recipient: person,
					attendee: person,
					recurrenceId: "",
				});
			}
		}
		for (const email of fanOut.cancel) {
			const person = personOf(previousGuests, email);
			plans.push({
				method: CalendarInviteMethod.Cancel,
				calendarObjectId: object.calendarObjectId,
				icalData: object.icalData,
				collectionTimezone: collection.timezone,
				recipient: person,
				attendee: person,
				recurrenceId: "",
			});
		}
	}
	if (scheduling.answer !== undefined && result && storedOrganizer !== "") {
		from = accountByAddress(accounts, answeringAs);
		if (from) {
			const replier = { email: answeringAs, displayName: "" };
			plans.push({
				method: CalendarInviteMethod.Reply,
				calendarObjectId: result.calendarObjectId,
				icalData: result.icalData,
				collectionTimezone: collection.timezone,
				recipient: { email: storedOrganizer, displayName: "" },
				attendee: replier,
				recurrenceId:
					request.scope === RecurrenceScope.This ? request.recurrenceId : "",
				answer: scheduling.answer,
			});
		}
	}

	const sends =
		from && plans.length > 0
			? await queueSchedulingSends(
					deps.scheduling,
					accountConfigId,
					from,
					plans,
				)
			: [];
	return { ok: true, value: { object: result, sends } };
};

/**
 * Deletes an event, or one occurrence of it, and queues what that owes its
 * guests: a cancellation each when the whole event goes, the shortened event
 * when part of a series does. Only an event the reader organizes owes anything.
 */
export const deleteCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	request: ScopedRequest,
): Promise<CalendarOutcome<ScheduledWrite<CalendarObjectItem | null>>> => {
	const resolved = await resolveResource(
		deps,
		accountConfigId,
		request,
		"write",
	);
	if (!resolved.ok) return resolved;
	const { collection, object } = resolved.value;

	if (!etagMatches(request.ifMatch, object.etag)) {
		return refuseCalendar(
			"EtagMismatch",
			"this event has been written since you read it — read it again and reapply the change",
		);
	}

	const parsed = await parsedOrThrow(object);
	const accounts = await deps.scheduling.accounts();
	const selfAddresses = accounts.map((account) => account.email);
	const self = selfAddressSet(selfAddresses);
	const storedOrganizer = organizerOf(parsed.master);
	const guests = guestPeopleOf(parsed);
	const organizer =
		self.has(storedOrganizer) && guests.length > 0
			? accountByAddress(accounts, storedOrganizer)
			: undefined;

	const write = await applyScopedDelete(parsed, collection.timezone, {
		scope: request.scope,
		recurrenceId: request.recurrenceId,
		followingUid: "",
	});
	if (!write.ok) return write;
	const prepared = await prepareScopedWrite(
		deps,
		accountConfigId,
		object,
		collection.timezone,
		selfAddresses,
		write.value,
	);
	if (!prepared.ok) return prepared;
	const written = await commitPrepared(
		deps,
		accountConfigId,
		object,
		prepared.value,
	);
	const result = written.at(-1) ?? null;
	if (!organizer) {
		return { ok: true, value: { object: result, sends: [] } };
	}

	const fanOut = planDeleteFanOut(
		result === null,
		guests.map((guest) => guest.email),
	);
	const source = result ?? object;
	const sends = await queueSchedulingSends(
		deps.scheduling,
		accountConfigId,
		organizer,
		fanOut.recipients.map((email) => {
			const person = personOf(guests, email);
			return {
				method: fanOut.method,
				calendarObjectId: object.calendarObjectId,
				icalData: source.icalData,
				collectionTimezone: collection.timezone,
				recipient: person,
				attendee: person,
				recurrenceId: "",
			};
		}),
	);
	return { ok: true, value: { object: result, sends } };
};

/** The collection holding a resource, found among the ones given. */
const locateResource = async (
	deps: CalendarDeps,
	collections: CalendarCollectionItem[],
	calendarObjectId: string,
): Promise<ResolvedResource | undefined> => {
	for (const collection of collections) {
		const object = await deps.calendarObject.find(
			collection.calendarId,
			calendarObjectId,
		);
		if (object) return { collection, object };
	}
	return undefined;
};

const readCalendarIds = (value: unknown): string[] => {
	if (typeof value === "string") return value === "" ? [] : [value];
	if (Array.isArray(value)) return value.filter((id) => typeof id === "string");
	return [];
};

export const answerRefusal = (error: { code: string; message: string }) =>
	error.code === "NotFound"
		? notFound(error.message)
		: error.code === "EtagMismatch"
			? preconditionFailed(error.message)
			: badRequest(error);

export const readIfMatch = (
	context: Parameters<OperationHandler>[0],
): string | undefined => {
	const headers = (context.request.headers ?? {}) as Record<string, string>;
	return Object.entries(headers).find(
		([name]) => name.toLowerCase() === "if-match",
	)?.[1];
};

const scopedRequestOf = (
	context: Parameters<OperationHandler>[0],
): CalendarOutcome<ScopedRequest> => {
	const params = context.request.params as { calendarObjectId: string };
	const query = context.request.query as {
		calendarId?: string;
		scope?: string;
		recurrenceId?: string;
	};
	const scope = readScope(query.scope);
	if (!scope.ok) return scope;

	return {
		ok: true,
		value: {
			calendarId: query.calendarId ?? "",
			calendarObjectId: params.calendarObjectId,
			scope: scope.value,
			recurrenceId: query.recurrenceId ?? "",
			ifMatch: readIfMatch(context),
		},
	};
};

/** The scheduling sources a handler reads and writes through. */
const schedulingFor = (ctx: HandlerContext<"smtp">): CalendarScheduling =>
	calendarSchedulingOf({
		accountConfigId: ctx.identity.accountConfigId,
		account: ctx.client.account,
		accountSetting: ctx.client.accountSetting,
		outboxMessage: ctx.client.outboxMessage,
		outboxSchedulingPart: ctx.client.outboxSchedulingPart,
		queue: (input, part) =>
			ctx.client.outboxQueue.createAndSendScheduled(input, part),
	});

const readSchedulingFor = (ctx: HandlerContext): CalendarScheduling =>
	calendarSchedulingOf({
		accountConfigId: ctx.identity.accountConfigId,
		account: ctx.client.account,
		accountSetting: ctx.client.accountSetting,
		outboxMessage: ctx.client.outboxMessage,
		outboxSchedulingPart: ctx.client.outboxSchedulingPart,
		queue: () =>
			Promise.reject(new Error("a calendar read queues no scheduling message")),
	});

export const CalendarEventOperations: Record<
	CalendarEventOperationIds,
	OperationHandler<CalendarEventOperationIds, "smtp">
> = {
	CalendarEventOperations_listCalendarEvents: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const query = context.request.query as {
			from?: string;
			to?: string;
			calendarId?: string | string[];
			calendarObjectId?: string;
		};
		const window = readWindow(query.from, query.to);
		if (!window.ok) return badRequest(window.error);

		const deps = calendarDepsOf(ctx.client);
		const collections = await collectionsForListing(
			deps,
			accountConfigId,
			readCalendarIds(query.calendarId),
		);
		if (!collections.ok) return answerRefusal(collections.error);
		const self = selfAddressSet(await selfAddressesFor(deps, accountConfigId));

		if (query.calendarObjectId) {
			const located = await locateResource(
				deps,
				collections.value,
				query.calendarObjectId,
			);
			if (!located) return { items: [] };
			const own = await listObjectInstances(
				deps,
				located.collection,
				located.object,
				window.value,
				self,
			);
			return { items: own.map(toInstanceResponse) };
		}

		const instances = await listCalendarInstances(
			deps,
			collections.value,
			window.value,
			self,
		);
		return { items: instances.map(toInstanceResponse) };
	},

	CalendarEventOperations_createCalendarEvent: async (
		context,
		ctx: HandlerContext<"smtp">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const input = context.request.requestBody as CreateCalendarEventInput;
		const scheduling = schedulingFor(ctx);
		const deps = calendarEventDepsOf(calendarDepsOf(ctx.client), scheduling);

		const created = await createCalendarEventFor(deps, accountConfigId, input);
		if (!created.ok) return answerRefusal(created.error);
		const self = selfAddressSet(await selfAddressesFor(deps, accountConfigId));
		return toEventResponse(created.value.object, self, created.value.sends);
	},
};

export const CalendarEventDetailOperations: Record<
	CalendarEventDetailOperationIds,
	OperationHandler<CalendarEventDetailOperationIds, "smtp">
> = {
	CalendarEventDetailOperations_getCalendarEvent: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const request = scopedRequestOf(context);
		if (!request.ok) return badRequest(request.error);
		const scheduling = readSchedulingFor(ctx);
		const deps = calendarEventDepsOf(calendarDepsOf(ctx.client), scheduling);
		const self = selfAddressSet(await selfAddressesFor(deps, accountConfigId));

		if (request.value.calendarId === "") {
			const located = await locateResource(
				deps,
				await listCalendarsFor(deps, accountConfigId),
				request.value.calendarObjectId,
			);
			if (!located) {
				return notFound(
					`no event ${request.value.calendarObjectId} on this account`,
				);
			}
			return toEventResponse(
				located.object,
				self,
				await pendingSends(scheduling, located.object.calendarObjectId),
			);
		}

		const resolved = await resolveResource(
			deps,
			accountConfigId,
			request.value,
			"read",
		);
		if (!resolved.ok) return answerRefusal(resolved.error);
		return toEventResponse(
			resolved.value.object,
			self,
			await pendingSends(scheduling, resolved.value.object.calendarObjectId),
		);
	},

	CalendarEventDetailOperations_updateCalendarEvent: async (
		context,
		ctx: HandlerContext<"smtp">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const body = context.request
			.requestBody as Partial<UpdateCalendarEventInput>;
		const request = scopedRequestOf(context);
		if (!request.ok) return badRequest(request.error);
		const scheduling = schedulingFor(ctx);
		const deps = calendarEventDepsOf(calendarDepsOf(ctx.client), scheduling);

		const updated = await updateCalendarEventFor(
			deps,
			accountConfigId,
			request.value,
			pickEventUpdate(body),
			pickSchedulingUpdate(body),
		);
		if (!updated.ok) return answerRefusal(updated.error);
		if (!updated.value.object) {
			throw new Error("a scoped update resolved to a delete");
		}
		const self = selfAddressSet(await selfAddressesFor(deps, accountConfigId));
		return toEventResponse(updated.value.object, self, updated.value.sends);
	},

	CalendarEventDetailOperations_deleteCalendarEvent: async (
		context,
		ctx: HandlerContext<"smtp">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const request = scopedRequestOf(context);
		if (!request.ok) return badRequest(request.error);
		const scheduling = schedulingFor(ctx);
		const deps = calendarEventDepsOf(calendarDepsOf(ctx.client), scheduling);

		const removed = await deleteCalendarEventFor(
			deps,
			accountConfigId,
			request.value,
		);
		if (!removed.ok) return answerRefusal(removed.error);
		return { statusCode: 200, body: { sends: removed.value.sends } };
	},
};

export const CalendarFreeBusyOperations: Record<
	CalendarFreeBusyOperationIds,
	OperationHandler<CalendarFreeBusyOperationIds>
> = {
	CalendarFreeBusyOperations_listCalendarFreeBusy: async (
		context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const query = context.request.query as { from?: string; to?: string };
		const window = readWindow(query.from, query.to);
		if (!window.ok) return badRequest(window.error);

		const deps = calendarDepsOf(ctx.client);
		const collections = (await listCalendarsFor(deps, accountConfigId)).filter(
			(collection) =>
				collection.componentSet === CalendarComponentSet.VeventOnly,
		);
		const self = selfAddressSet(await selfAddressesFor(deps, accountConfigId));
		const spans = await listBusySpans(deps, collections, window.value, self);
		const items: CalendarFreeBusySpan[] = spans.map((span) => ({
			start: toOffsetIso(span.startMs, "UTC"),
			end: toOffsetIso(span.endMs, "UTC"),
		}));
		return { items };
	},
};
