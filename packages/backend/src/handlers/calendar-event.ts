import type {
	CalendarEventInstance,
	CalendarEventResponse,
	CalendarFreeBusySpan,
	CreateCalendarEventInput,
	UpdateCalendarEventInput,
} from "@remit/api-openapi-types";
import {
	applyScopedDelete,
	applyScopedUpdate,
	buildEventCalendar,
	type CalendarEventFields,
	type CalendarInstance,
	type CalendarWindow,
	deleteCalendarObject,
	listBusySpans,
	listCalendarInstances,
	parseCalendar,
	putCalendarObject,
	type RecurrenceScopeValue,
	type ScopedWrite,
	toOffsetIso,
	toUtcIso,
} from "@remit/calendar-service";
import type {
	CalendarCollectionItem,
	CalendarObjectItem,
} from "@remit/data-ports";
import { base36uuid } from "@remit/data-ports/id";
import { RecurrenceScope } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/data-client.js";
import type {
	CalendarEventDetailOperationIds,
	CalendarEventOperationIds,
	CalendarFreeBusyOperationIds,
	OperationHandler,
} from "../types.js";
import {
	badRequest,
	type CalendarDeps,
	type CalendarOutcome,
	calendarDepsOf,
	findCalendarFor,
	listCalendarsFor,
	notFound,
	preconditionFailed,
	refuseCalendar,
} from "./calendar.js";

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
}

export const calendarEventDepsOf = (deps: CalendarDeps): CalendarEventDeps => ({
	...deps,
	newId: base36uuid,
	now: () => new Date(),
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
	if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
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

/** The collections a listing covers, defaulting to every one the caller holds. */
export const collectionsForListing = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarIds: string[],
): Promise<CalendarOutcome<CalendarCollectionItem[]>> => {
	const held = await listCalendarsFor(deps, accountConfigId);
	if (calendarIds.length === 0) return { ok: true, value: held };

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
});

const toEventResponse = (
	object: CalendarObjectItem,
): CalendarEventResponse => ({
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
});

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

const readScope = (value: unknown): RecurrenceScopeValue =>
	value === RecurrenceScope.This || value === RecurrenceScope.Following
		? value
		: RecurrenceScope.All;

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
	write: ScopedWrite,
): Promise<CalendarOutcome<CalendarObjectItem | null>> => {
	if (write.kind === "Delete") {
		await deleteCalendarObject(deps.calendarUnitOfWork, {
			accountConfigId,
			calendarId: object.calendarId,
			calendarObjectId: object.calendarObjectId,
		});
		return { ok: true, value: null };
	}

	return deps.calendarUnitOfWork.transaction(async () => {
		const head = await putCalendarObject(deps.calendarUnitOfWork, {
			accountConfigId,
			calendarId: object.calendarId,
			resourceName: object.resourceName,
			icalData: write.icalData,
		});
		if (!head.ok) return head;
		if (write.kind === "Replace") return { ok: true, value: head.value };

		const following = await putCalendarObject(deps.calendarUnitOfWork, {
			accountConfigId,
			calendarId: object.calendarId,
			resourceName: `${deps.newId()}.ics`,
			icalData: write.following,
		});
		if (!following.ok) return following;
		return { ok: true, value: head.value };
	});
};

export const createCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	input: CreateCalendarEventInput,
): Promise<CalendarOutcome<CalendarObjectItem>> => {
	const collection = await findCalendarFor(
		deps,
		accountConfigId,
		input.calendarId,
	);
	if (!collection.ok) return collection;

	const id = deps.newId();
	const built = await buildEventCalendar(
		eventFieldsOf(input),
		`${id}@reader.remit`,
		deps.now(),
	);
	if (!built.ok) return built;

	return putCalendarObject(deps.calendarUnitOfWork, {
		accountConfigId,
		calendarId: collection.value.calendarId,
		resourceName: `${id}.ics`,
		icalData: built.value,
	});
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
	deps: CalendarEventDeps,
	accountConfigId: string,
	request: Pick<ScopedRequest, "calendarId" | "calendarObjectId">,
): Promise<CalendarOutcome<ResolvedResource>> => {
	const collection = await findCalendarFor(
		deps,
		accountConfigId,
		request.calendarId,
	);
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

export const updateCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	request: ScopedRequest,
	patch: Partial<CalendarEventFields>,
): Promise<CalendarOutcome<CalendarObjectItem | null>> => {
	const resolved = await resolveResource(deps, accountConfigId, request);
	if (!resolved.ok) return resolved;
	const { collection, object } = resolved.value;

	if (!etagMatches(request.ifMatch, object.etag)) {
		return refuseCalendar(
			"EtagMismatch",
			"this event has been written since you read it — read it again and reapply the change",
		);
	}

	const parsed = await parseCalendar(object.icalData);
	if (!parsed.ok) {
		throw new Error(
			`stored calendar object ${object.calendarObjectId} no longer parses: ${parsed.error.message}`,
		);
	}

	const write = await applyScopedUpdate(
		parsed.value,
		collection.timezone,
		{
			scope: request.scope,
			recurrenceId: request.recurrenceId,
			followingUid: `${deps.newId()}@reader.remit`,
		},
		patch,
	);
	if (!write.ok) return write;
	return commitScopedWrite(deps, accountConfigId, object, write.value);
};

export const deleteCalendarEventFor = async (
	deps: CalendarEventDeps,
	accountConfigId: string,
	request: ScopedRequest,
): Promise<CalendarOutcome<CalendarObjectItem | null>> => {
	const resolved = await resolveResource(deps, accountConfigId, request);
	if (!resolved.ok) return resolved;
	const { collection, object } = resolved.value;

	if (!etagMatches(request.ifMatch, object.etag)) {
		return refuseCalendar(
			"EtagMismatch",
			"this event has been written since you read it — read it again and reapply the change",
		);
	}

	const parsed = await parseCalendar(object.icalData);
	if (!parsed.ok) {
		throw new Error(
			`stored calendar object ${object.calendarObjectId} no longer parses: ${parsed.error.message}`,
		);
	}

	const write = await applyScopedDelete(parsed.value, collection.timezone, {
		scope: request.scope,
		recurrenceId: request.recurrenceId,
		followingUid: "",
	});
	if (!write.ok) return write;
	return commitScopedWrite(deps, accountConfigId, object, write.value);
};

const readCalendarIds = (value: unknown): string[] => {
	if (typeof value === "string") return value === "" ? [] : [value];
	if (Array.isArray(value)) return value.filter((id) => typeof id === "string");
	return [];
};

const answerRefusal = (error: { code: string; message: string }) =>
	error.code === "NotFound"
		? notFound(error.message)
		: error.code === "EtagMismatch"
			? preconditionFailed(error.message)
			: badRequest(error);

const scopedRequestOf = (
	context: Parameters<OperationHandler>[0],
): ScopedRequest => {
	const params = context.request.params as { calendarObjectId: string };
	const query = context.request.query as {
		calendarId?: string;
		scope?: string;
		recurrenceId?: string;
	};
	const headers = (context.request.headers ?? {}) as Record<string, string>;
	const ifMatch = Object.entries(headers).find(
		([name]) => name.toLowerCase() === "if-match",
	)?.[1];
	return {
		calendarId: query.calendarId ?? "",
		calendarObjectId: params.calendarObjectId,
		scope: readScope(query.scope),
		recurrenceId: query.recurrenceId ?? "",
		ifMatch,
	};
};

export const CalendarEventOperations: Record<
	CalendarEventOperationIds,
	OperationHandler<CalendarEventOperationIds>
> = {
	CalendarEventOperations_listCalendarEvents: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const query = context.request.query as {
			from?: string;
			to?: string;
			calendarId?: string | string[];
		};
		const window = readWindow(query.from, query.to);
		if (!window.ok) return badRequest(window.error);

		const deps = calendarDepsOf(await getClient());
		const collections = await collectionsForListing(
			deps,
			accountConfigId,
			readCalendarIds(query.calendarId),
		);
		if (!collections.ok) return answerRefusal(collections.error);

		const instances = await listCalendarInstances(
			deps,
			collections.value,
			window.value,
		);
		return { items: instances.map(toInstanceResponse) };
	},

	CalendarEventOperations_createCalendarEvent: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const input = context.request.requestBody as CreateCalendarEventInput;
		const deps = calendarEventDepsOf(calendarDepsOf(await getClient()));

		const created = await createCalendarEventFor(deps, accountConfigId, input);
		if (!created.ok) return answerRefusal(created.error);
		return toEventResponse(created.value);
	},
};

export const CalendarEventDetailOperations: Record<
	CalendarEventDetailOperationIds,
	OperationHandler<CalendarEventDetailOperationIds>
> = {
	CalendarEventDetailOperations_getCalendarEvent: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const request = scopedRequestOf(context);
		const deps = calendarEventDepsOf(calendarDepsOf(await getClient()));

		const resolved = await resolveResource(deps, accountConfigId, request);
		if (!resolved.ok) return answerRefusal(resolved.error);
		return toEventResponse(resolved.value.object);
	},

	CalendarEventDetailOperations_updateCalendarEvent: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const body = context.request
			.requestBody as Partial<UpdateCalendarEventInput>;
		const deps = calendarEventDepsOf(calendarDepsOf(await getClient()));

		const updated = await updateCalendarEventFor(
			deps,
			accountConfigId,
			scopedRequestOf(context),
			pickEventUpdate(body),
		);
		if (!updated.ok) return answerRefusal(updated.error);
		if (!updated.value) {
			throw new Error("a scoped update resolved to a delete");
		}
		return toEventResponse(updated.value);
	},

	CalendarEventDetailOperations_deleteCalendarEvent: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const deps = calendarEventDepsOf(calendarDepsOf(await getClient()));

		const removed = await deleteCalendarEventFor(
			deps,
			accountConfigId,
			scopedRequestOf(context),
		);
		if (!removed.ok) return answerRefusal(removed.error);
		return { statusCode: 204 };
	},
};

export const CalendarFreeBusyOperations: Record<
	CalendarFreeBusyOperationIds,
	OperationHandler<CalendarFreeBusyOperationIds>
> = {
	CalendarFreeBusyOperations_listCalendarFreeBusy: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const query = context.request.query as { from?: string; to?: string };
		const window = readWindow(query.from, query.to);
		if (!window.ok) return badRequest(window.error);

		const deps = calendarDepsOf(await getClient());
		const collections = await listCalendarsFor(deps, accountConfigId);
		const spans = await listBusySpans(deps, collections, window.value);
		const items: CalendarFreeBusySpan[] = spans.map((span) => ({
			start: toOffsetIso(span.startMs, "UTC"),
			end: toOffsetIso(span.endMs, "UTC"),
		}));
		return { items };
	},
};
