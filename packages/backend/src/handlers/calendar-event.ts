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
	applyGuestList,
	applyScopedDelete,
	applyScopedUpdate,
	attendeesOf,
	buildEventCalendar,
	buildSchedulingMessage,
	type CalendarEventFields,
	type CalendarInstance,
	type CalendarWindow,
	countAttendees,
	deleteCalendarObject,
	type EventSchedulingUpdate,
	followingUidOf,
	listBusySpans,
	listCalendarInstances,
	listObjectInstances,
	OFFSET_BEARING,
	organizerOf,
	type ParsedCalendar,
	parseCalendar,
	participationOf,
	planCreateSends,
	planDeleteSends,
	planEventCreate,
	planEventUpdate,
	planUpdateSends,
	prepareCalendarObject,
	putCalendarObject,
	type RecurrenceScopeValue,
	readWrittenObject,
	type SchedulingSends,
	type ScopedWrite,
	SUGGESTION_STATE_OF_ANSWER,
	schedulingBody,
	schedulingSubject,
	selfAddressSet,
	shapeScheduledUpdate,
	toOffsetIso,
	toUtcIso,
} from "@remit/calendar-service";
import type {
	AccountItem,
	CalendarCollectionItem,
	CalendarObjectItem,
	CreateOutboxSchedulingPartInput,
	OutboxMessageItem,
	PutCalendarObjectWrite,
} from "@remit/data-ports";
import { base36uuid } from "@remit/data-ports/id";
import { CalendarComponentSet, RecurrenceScope } from "@remit/domain-enums";
import type { CreateDraftInput } from "@remit/mailbox-service";
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
} from "./calendar.js";
import { chosenInvitationSender } from "./user-settings.js";

/**
 * The widest window a single read may ask for. A year covers every view the
 * client has — a year grid is the coarsest — and keeps one request from asking
 * the server to expand a decade of a daily series.
 */
export const CALENDAR_MAX_WINDOW_DAYS = 366;

const MAX_WINDOW_MS = CALENDAR_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Queues one scheduling message with its part; a failed enqueue answers with the failed row. */
export type QueueScheduled = (
	input: CreateDraftInput,
	part: CreateOutboxSchedulingPartInput,
) => Promise<OutboxMessageItem>;

/** What an event write needs beyond the reads: ids, a clock, and the outbox. */
export interface CalendarEventDeps extends CalendarDeps {
	newId: () => string;
	now: () => Date;
	queueScheduled: QueueScheduled;
}

export const calendarEventDepsOf = (
	deps: CalendarDeps,
	queueScheduled: QueueScheduled,
): CalendarEventDeps => ({
	...deps,
	newId: base36uuid,
	now: () => new Date(),
	queueScheduled,
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

/** The account config's accounts: who the reader is, and who can send. */
const accountsOf = (
	deps: CalendarDeps,
	accountConfigId: string,
): Promise<AccountItem[]> =>
	deps.accounts.listAllByAccountConfig(accountConfigId);

const selfOf = (accounts: readonly AccountItem[]): ReadonlySet<string> =>
	selfAddressSet(accounts.map((account) => account.email));

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
	deps: CalendarDeps,
	accountConfigId: string,
	calendarObjectId: string,
): Promise<CalendarSchedulingSend[]> => {
	const parts = await deps.outboxSchedulingPart.listByCalendarObject(
		accountConfigId,
		calendarObjectId,
	);
	if (parts.length === 0) return [];
	const rows = await deps.outboxMessage.get(
		accountConfigId,
		parts.map((part) => part.outboxMessageId),
	);
	const byId = new Map(rows.map((row) => [row.outboxMessageId, row]));
	return parts.flatMap((part) => {
		const row = byId.get(part.outboxMessageId);
		return row
			? [
					{
						email: part.recipient,
						outboxMessageId: row.outboxMessageId,
						method: part.method as CalendarSchedulingSend["method"],
						status: row.status,
					},
				]
			: [];
	});
};

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
	});
	if (!following.ok) return following;
	return {
		ok: true,
		value: { kind: "Split", puts: [head.value, following.value] },
	};
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

/** An event write, and the scheduling messages it queued. */
export interface ScheduledWrite<T> {
	object: T;
	sends: CalendarSchedulingSend[];
}

/**
 * Queues every planned message, one outbox row each, from the account the plan
 * names. The rows are the pending records; the send worker settles each one.
 */
const queueSends = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	sends: SchedulingSends<AccountItem> | null,
): Promise<CalendarSchedulingSend[]> => {
	if (!sends) return [];
	const queued: CalendarSchedulingSend[] = [];
	for (const plan of sends.plans) {
		const message = await buildSchedulingMessage(plan.icalData, {
			method: plan.method,
			now: deps.now(),
			attendee: plan.attendee,
			recurrenceId: plan.recurrenceId,
			collectionTimezone: plan.collectionTimezone,
		});
		const subject = schedulingSubject(
			plan.method,
			message.summary,
			plan.answer,
		);
		const row = await deps.queueScheduled(
			{
				accountId: sends.from.accountId,
				accountConfigId,
				fromAddress: sends.from.email,
				toAddresses: [plan.recipient.email],
				subject,
				textBody: schedulingBody(subject, message.icalData),
			},
			{
				calendarObjectId: plan.calendarObjectId,
				recipient: plan.recipient.email,
				method: plan.method,
				sequence: message.sequence,
				icalData: message.icalData,
			},
		);
		queued.push({
			email: plan.recipient.email,
			outboxMessageId: row.outboxMessageId,
			method: plan.method,
			status: row.status,
		});
	}
	return queued;
};

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

	const planned = planEventCreate(
		await accountsOf(deps, accountConfigId),
		await chosenInvitationSender(deps.accountSetting, accountConfigId),
		input.attendees ?? [],
		input.organizerAccountId,
	);
	if (!planned.ok) return planned;

	const id = deps.newId();
	const built = await buildEventCalendar(
		eventFieldsOf(input),
		`${id}@reader.remit`,
		deps.now(),
	);
	if (!built.ok) return built;
	const icalData = planned.value
		? await applyGuestList(
				built.value,
				{ email: planned.value.organizer.email, displayName: "" },
				planned.value.guests,
			)
		: built.value;

	const stored = await putCalendarObject(deps.calendarStore, {
		accountConfigId,
		calendarId: collection.value.calendarId,
		resourceName: `${id}.ics`,
		icalData,
	});
	if (!stored.ok) return stored;
	const sends = planned.value
		? await queueSends(
				deps,
				accountConfigId,
				planCreateSends(planned.value, stored.value, collection.value.timezone),
			)
		: [];
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
				state: SUGGESTION_STATE_OF_ANSWER[answer],
				acceptedCalendarObjectId: calendarObjectId,
			},
		})),
	);
};

const refuseStale = <T>(): CalendarOutcome<T> =>
	refuseCalendar(
		"EtagMismatch",
		"this event has been written since you read it — read it again and reapply the change",
	);

/**
 * Edits an event, and queues what the edit owes its guests.
 *
 * The calendar row is local truth and is written first. The outbox rows are
 * the pending records of the messages that follow it: an invitation to every
 * guest of an event the reader organizes, a cancellation to a guest the edit
 * removed, a reply to the organizer when the reader answers as a guest. The
 * outbox lives in another database and is not written in the calendar's
 * commit; a later edit made while an earlier message is still queued does not
 * wait for it, and each message carries the SEQUENCE of the bytes it was built
 * from, so a recipient keeps the newest.
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
	if (!etagMatches(request.ifMatch, object.etag)) return refuseStale();

	const parsed = await parsedOrThrow(object);
	const accounts = await accountsOf(deps, accountConfigId);
	const planned = planEventUpdate(
		parsed,
		accounts,
		await chosenInvitationSender(deps.accountSetting, accountConfigId),
		request.scope,
		scheduling,
	);
	if (!planned.ok) return planned;

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
	const shaped = await shapeScheduledUpdate(
		write.value,
		planned.value,
		scheduling,
		patch,
		collection.timezone,
		request.scope,
		request.recurrenceId,
	);
	if (!shaped.ok) return shaped;

	const prepared = await prepareScopedWrite(
		deps,
		accountConfigId,
		object,
		collection.timezone,
		shaped.value,
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

	const sends = await queueSends(
		deps,
		accountConfigId,
		await planUpdateSends(
			planned.value,
			accounts,
			scheduling,
			object,
			written,
			collection.timezone,
			request.scope,
			request.recurrenceId,
		),
	);
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
	if (!etagMatches(request.ifMatch, object.etag)) return refuseStale();

	const parsed = await parsedOrThrow(object);
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
	const sends = await queueSends(
		deps,
		accountConfigId,
		planDeleteSends(
			parsed,
			await accountsOf(deps, accountConfigId),
			object,
			result,
			collection.timezone,
		),
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

const writeDepsOf = (ctx: HandlerContext<"smtp">): CalendarEventDeps =>
	calendarEventDepsOf(calendarDepsOf(ctx.client), (input, part) =>
		ctx.client.outboxQueue.createAndSendScheduled(input, part),
	);

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
		const self = selfOf(await accountsOf(deps, accountConfigId));

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
		const deps = writeDepsOf(ctx);

		const created = await createCalendarEventFor(deps, accountConfigId, input);
		if (!created.ok) return answerRefusal(created.error);
		return toEventResponse(
			created.value.object,
			selfOf(await accountsOf(deps, accountConfigId)),
			created.value.sends,
		);
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
		const deps = calendarDepsOf(ctx.client);
		const self = selfOf(await accountsOf(deps, accountConfigId));

		const found =
			request.value.calendarId === ""
				? await locateResource(
						deps,
						await listCalendarsFor(deps, accountConfigId),
						request.value.calendarObjectId,
					)
				: undefined;
		if (request.value.calendarId === "" && !found) {
			return notFound(
				`no event ${request.value.calendarObjectId} on this account`,
			);
		}
		const resolved = found
			? ({ ok: true, value: found } as const)
			: await resolveResource(deps, accountConfigId, request.value, "read");
		if (!resolved.ok) return answerRefusal(resolved.error);
		return toEventResponse(
			resolved.value.object,
			self,
			await pendingSends(
				deps,
				accountConfigId,
				resolved.value.object.calendarObjectId,
			),
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
		const deps = writeDepsOf(ctx);

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
		return toEventResponse(
			updated.value.object,
			selfOf(await accountsOf(deps, accountConfigId)),
			updated.value.sends,
		);
	},

	CalendarEventDetailOperations_deleteCalendarEvent: async (
		context,
		ctx: HandlerContext<"smtp">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const request = scopedRequestOf(context);
		if (!request.ok) return badRequest(request.error);

		const removed = await deleteCalendarEventFor(
			writeDepsOf(ctx),
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
		const spans = await listBusySpans(
			deps,
			collections,
			window.value,
			selfOf(await accountsOf(deps, accountConfigId)),
		);
		const items: CalendarFreeBusySpan[] = spans.map((span) => ({
			start: toOffsetIso(span.startMs, "UTC"),
			end: toOffsetIso(span.endMs, "UTC"),
		}));
		return { items };
	},
};
