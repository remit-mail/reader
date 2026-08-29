import type {
	CalendarResponse,
	CreateCalendarInput,
	UpdateCalendarInput,
} from "@remit/api-openapi-types";
import {
	DEFAULT_CALENDAR_URL_SEGMENT,
	isResolvableZone,
	provisionDefaultCalendar,
	putCalendarObject,
} from "@remit/calendar-service";
import type {
	CalendarCollectionItem,
	ICalendarCollectionRepository,
	ICalendarEventIndexRepository,
	ICalendarObjectRepository,
	ICalendarUnitOfWork,
	UpdateCalendarCollectionInput,
} from "@remit/data-ports";
import { normalizeCalendarUrlSegment } from "@remit/data-ports/id";
import { CalendarSource } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import type { RemitClient } from "../service/data-client.js";
import { getClient } from "../service/data-client.js";
import type {
	CalendarDetailOperationIds,
	CalendarOperationIds,
	OperationHandler,
} from "../types.js";

/** The calendar store, as the handlers reach it. */
export interface CalendarDeps {
	calendarCollection: ICalendarCollectionRepository;
	calendarObject: ICalendarObjectRepository;
	calendarEventIndex: ICalendarEventIndexRepository;
	calendarUnitOfWork: ICalendarUnitOfWork;
}

/** Why a calendar request was refused, in a form a client can branch on. */
export interface CalendarRefusal {
	code: string;
	message: string;
}

/**
 * A refusal is a value here, not a throw. Every one of these is something the
 * caller sent — a window that runs backwards, a segment already taken, a
 * RECURRENCE-ID naming no occurrence — so it is an ordinary outcome of the
 * request rather than a fault of the server's.
 */
export type CalendarOutcome<T> =
	| { ok: true; value: T }
	| { ok: false; error: CalendarRefusal };

export const refuseCalendar = <T>(
	code: string,
	message: string,
): CalendarOutcome<T> => ({ ok: false, error: { code, message } });

export const badRequest = (error: CalendarRefusal) => ({
	statusCode: 400,
	body: error,
});

export const notFound = (message: string) => ({
	statusCode: 404,
	body: { code: "NotFound", message },
});

export const preconditionFailed = (message: string) => ({
	statusCode: 412,
	body: { code: "EtagMismatch", message },
});

/** The calendar half of the client, named so a handler takes only what it uses. */
export const calendarDepsOf = (client: RemitClient): CalendarDeps => ({
	calendarCollection: client.calendarCollection,
	calendarObject: client.calendarObject,
	calendarEventIndex: client.calendarEventIndex,
	calendarUnitOfWork: client.calendarUnitOfWork,
});

const toCalendarResponse = (
	item: CalendarCollectionItem,
): CalendarResponse => ({
	calendarId: item.calendarId,
	accountConfigId: item.accountConfigId,
	urlSegment: item.urlSegment,
	displayName: item.displayName,
	color: item.color,
	componentSet: item.componentSet,
	source: item.source,
	timezone: item.timezone,
	syncSequence: item.syncSequence,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

/**
 * Every collection the account config holds, provisioning the default one when
 * it holds none.
 *
 * Safe to race with itself: `calendarId` is derived from the account config and
 * the URL segment, so two first reads arriving together write the same row
 * rather than two, and the loser's write is a no-op instead of a second
 * calendar nobody asked for.
 */
export const listCalendarsFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
): Promise<CalendarCollectionItem[]> => {
	const existing =
		await deps.calendarCollection.listByAccountConfig(accountConfigId);
	if (existing.length > 0) return existing;

	await provisionDefaultCalendar(deps.calendarUnitOfWork, accountConfigId);
	return deps.calendarCollection.listByAccountConfig(accountConfigId);
};

/** One of the caller's collections, or a refusal naming the one they asked for. */
export const findCalendarFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<CalendarCollectionItem>> => {
	const collections =
		await deps.calendarCollection.listByAccountConfig(accountConfigId);
	const found = collections.find(
		(collection) => collection.calendarId === calendarId,
	);
	if (!found) {
		return refuseCalendar(
			"NotFound",
			`no calendar ${calendarId} on this account`,
		);
	}
	return { ok: true, value: found };
};

/**
 * A collection's timezone is what every floating time in it is read in, so a
 * name this server cannot resolve is not a cosmetic setting — it silently moves
 * every all-day and unzoned event in the calendar. A Windows zone name, which
 * is what a client that has not normalised its input sends, is refused here
 * rather than stored and quietly read as UTC.
 */
export const readCollectionTimezone = (
	timezone: string | undefined,
): CalendarOutcome<string> => {
	if (timezone === undefined || timezone === "") return { ok: true, value: "" };
	if (!isResolvableZone(timezone)) {
		return refuseCalendar(
			"UnknownTimeZone",
			`"${timezone}" is not a time zone this server can resolve — use an IANA name such as "Europe/Amsterdam"`,
		);
	}
	return { ok: true, value: timezone };
};

export const createCalendarFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	input: CreateCalendarInput,
): Promise<CalendarOutcome<CalendarCollectionItem>> => {
	const urlSegment = normalizeCalendarUrlSegment(input.urlSegment);
	if (urlSegment === "") {
		return refuseCalendar(
			"InvalidUrlSegment",
			"a calendar needs a url segment to be addressed by",
		);
	}

	const timezone = readCollectionTimezone(input.timezone);
	if (!timezone.ok) return timezone;

	// The write decides, not a prior read: two creates of one segment arriving
	// together would both find it free, and the loser would silently be handed
	// the winner's calendar to write into.
	const created = await deps.calendarUnitOfWork.transaction((repos) =>
		repos.calendarCollection.createExclusive({
			accountConfigId,
			urlSegment,
			displayName: input.displayName,
			color: input.color,
			timezone: timezone.value,
			source: CalendarSource.UserCreated,
		}),
	);
	if (!created) {
		return refuseCalendar(
			"UrlSegmentTaken",
			`"${urlSegment}" already addresses a calendar on this account — pick another`,
		);
	}
	return { ok: true, value: created };
};

/**
 * Removes a collection with everything in it, in one unit.
 *
 * The default collection stays: it is where an accepted invitation and a first
 * event land, and an account config with no calendar has nowhere to put one.
 */
export const deleteCalendarFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<null>> => {
	const collection = await findCalendarFor(deps, accountConfigId, calendarId);
	if (!collection.ok) return collection;
	if (collection.value.source === CalendarSource.Default) {
		return refuseCalendar(
			"DefaultCalendarUndeletable",
			`"${DEFAULT_CALENDAR_URL_SEGMENT}" is the calendar this account files events into and cannot be removed`,
		);
	}

	await deps.calendarUnitOfWork.transaction(async (repos) => {
		const objects = await repos.calendarObject.listByCalendar(calendarId);
		for (const object of objects) {
			await repos.calendarEventIndex.deleteForObject(
				calendarId,
				object.calendarObjectId,
			);
			await repos.calendarObject.delete(calendarId, object.calendarObjectId);
		}
		await repos.calendarCollection.delete(accountConfigId, calendarId);
	});
	return { ok: true, value: null };
};

/**
 * Reduce a PATCH body to the fields a collection update may set. `urlSegment`
 * is deliberately absent: it is the collection's identity and the path a client
 * has bookmarked, so moving it is making a different calendar.
 */
export const pickCalendarUpdate = (
	body: Partial<UpdateCalendarInput>,
): UpdateCalendarCollectionInput => {
	const patch: UpdateCalendarCollectionInput = {};
	if (Object.hasOwn(body, "displayName")) patch.displayName = body.displayName;
	if (Object.hasOwn(body, "color")) patch.color = body.color;
	if (Object.hasOwn(body, "timezone")) patch.timezone = body.timezone;
	return patch;
};

/**
 * Applies a collection patch, rewriting what the collection's timezone decides.
 *
 * The timezone is not a label. Every floating and all-day time in the
 * collection is read in it, so changing it moves every occurrence row those
 * resources produced — and a row left at the old zone is an event drawn hours
 * from where the calendar now says it is. Each resource is therefore written
 * again from its own stored bytes, which re-projects and re-expands it and
 * bumps the collection's sequence so a syncing client sees the change. The
 * whole set is one unit: a half-converted calendar is worse than either zone.
 */
export const updateCalendarFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
	body: Partial<UpdateCalendarInput>,
): Promise<CalendarOutcome<CalendarCollectionItem>> => {
	const current = await findCalendarFor(deps, accountConfigId, calendarId);
	if (!current.ok) return current;

	const patch = pickCalendarUpdate(body);
	if (patch.timezone !== undefined) {
		const timezone = readCollectionTimezone(patch.timezone);
		if (!timezone.ok) return timezone;
		patch.timezone = timezone.value;
	}
	const rezone =
		patch.timezone !== undefined && patch.timezone !== current.value.timezone;

	const updated = await deps.calendarUnitOfWork.transaction(async (repos) => {
		const collection = await repos.calendarCollection.update(
			accountConfigId,
			calendarId,
			patch,
		);
		if (!rezone) return collection;

		const objects = await repos.calendarObject.listByCalendar(calendarId);
		for (const object of objects) {
			const rewritten = await putCalendarObject(deps.calendarUnitOfWork, {
				accountConfigId,
				calendarId,
				resourceName: object.resourceName,
				icalData: object.icalData,
			});
			if (!rewritten.ok) {
				throw new Error(
					`stored calendar object ${object.calendarObjectId} was refused on re-expansion: ${rewritten.error.code}`,
				);
			}
		}
		return repos.calendarCollection.get(accountConfigId, calendarId);
	});
	return { ok: true, value: updated };
};

export const CalendarOperations: Record<
	CalendarOperationIds,
	OperationHandler<CalendarOperationIds>
> = {
	CalendarOperations_listCalendars: async (_context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const deps = calendarDepsOf(await getClient());
		const items = await listCalendarsFor(deps, accountConfigId);
		return { items: items.map(toCalendarResponse) };
	},

	CalendarOperations_createCalendar: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const input = context.request.requestBody as CreateCalendarInput;
		const deps = calendarDepsOf(await getClient());

		const created = await createCalendarFor(deps, accountConfigId, input);
		if (!created.ok) return badRequest(created.error);
		return toCalendarResponse(created.value);
	},
};

export const CalendarDetailOperations: Record<
	CalendarDetailOperationIds,
	OperationHandler<CalendarDetailOperationIds>
> = {
	CalendarDetailOperations_getCalendar: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const deps = calendarDepsOf(await getClient());

		const found = await findCalendarFor(deps, accountConfigId, calendarId);
		if (!found.ok) return notFound(found.error.message);
		return toCalendarResponse(found.value);
	},

	CalendarDetailOperations_updateCalendar: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const body = context.request.requestBody as Partial<UpdateCalendarInput>;
		const deps = calendarDepsOf(await getClient());

		const updated = await updateCalendarFor(
			deps,
			accountConfigId,
			calendarId,
			body,
		);
		if (!updated.ok) {
			return updated.error.code === "NotFound"
				? notFound(updated.error.message)
				: badRequest(updated.error);
		}
		return toCalendarResponse(updated.value);
	},

	CalendarDetailOperations_deleteCalendar: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const deps = calendarDepsOf(await getClient());

		const removed = await deleteCalendarFor(deps, accountConfigId, calendarId);
		if (!removed.ok) {
			return removed.error.code === "NotFound"
				? notFound(removed.error.message)
				: badRequest(removed.error);
		}
		return { statusCode: 204 };
	},
};
