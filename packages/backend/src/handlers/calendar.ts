import type {
	CalendarResponse,
	CreateCalendarInput,
	UpdateCalendarInput,
} from "@remit/api-openapi-types";
import {
	DEFAULT_CALENDAR_URL_SEGMENT,
	provisionDefaultCalendar,
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

/**
 * A backend with no calendar repositories cannot serve these endpoints, and
 * pretending otherwise would answer an empty calendar to somebody who has one.
 * This is a composition mistake rather than anything a caller did, so it fails
 * the request loudly.
 */
export const calendarDepsOf = (client: RemitClient): CalendarDeps => {
	const {
		calendarCollection,
		calendarObject,
		calendarEventIndex,
		calendarUnitOfWork,
	} = client;
	if (
		!calendarCollection ||
		!calendarObject ||
		!calendarEventIndex ||
		!calendarUnitOfWork
	) {
		throw new Error(
			"no calendar store on this data backend — register a client whose repositories include one",
		);
	}
	return {
		calendarCollection,
		calendarObject,
		calendarEventIndex,
		calendarUnitOfWork,
	};
};

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

	const taken = await deps.calendarCollection.findByUrlSegment(
		accountConfigId,
		urlSegment,
	);
	if (taken) {
		return refuseCalendar(
			"UrlSegmentTaken",
			`"${urlSegment}" already addresses the calendar "${taken.displayName}" — pick another`,
		);
	}

	const created = await deps.calendarUnitOfWork.transaction((repos) =>
		repos.calendarCollection.create({
			accountConfigId,
			urlSegment,
			displayName: input.displayName,
			color: input.color,
			timezone: input.timezone,
			source: CalendarSource.UserCreated,
		}),
	);
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

		const found = await findCalendarFor(deps, accountConfigId, calendarId);
		if (!found.ok) return notFound(found.error.message);

		const updated = await deps.calendarCollection.update(
			accountConfigId,
			calendarId,
			pickCalendarUpdate(body),
		);
		return toCalendarResponse(updated);
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
