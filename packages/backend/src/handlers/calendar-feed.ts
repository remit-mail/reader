import type {
	CalendarFeedResponse,
	CalendarFeedStateResponse,
} from "@remit/api-openapi-types";
import {
	buildCalendarFeed,
	calendarFeedIsUnchanged,
	calendarFeedTokenMatches,
	hashCalendarFeedToken,
	isCalendarFeedToken,
	mintCalendarFeedToken,
} from "@remit/calendar-service";
import type { CalendarFeedTokenItem } from "@remit/data-ports";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { type RawApiResponse, rawApiResponse } from "../response.js";
import { getClient } from "../service/data-client.js";
import type {
	CalendarDetailOperationIds,
	CalendarFeedDetailOperationIds,
	CalendarFeedOperationIds,
	OperationHandler,
} from "../types.js";
import {
	type CalendarDeps,
	type CalendarOutcome,
	calendarDepsOf,
	findCalendarFor,
	notFound,
	refuseCalendar,
} from "./calendar.js";

const toFeedState = (
	token: CalendarFeedTokenItem,
): CalendarFeedStateResponse => ({
	calendarId: token.calendarId,
	createdAt: token.createdAt,
	rotatedAt: token.rotatedAt,
});

/**
 * Mints the calendar's feed address, or replaces the one it has.
 *
 * The plaintext exists here and nowhere else: the store keeps a digest, so this
 * return value is the only chance anybody has to read the token. Ownership is
 * settled before the mint — a calendar the caller does not hold is absent, not
 * forbidden, which is the same answer `getCalendar` gives it.
 */
export const putCalendarFeedFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<CalendarFeedResponse>> => {
	const calendar = await findCalendarFor(deps, accountConfigId, calendarId);
	if (!calendar.ok) return calendar;

	const secret = mintCalendarFeedToken();
	const stored = await deps.calendarFeedToken.put({
		accountConfigId,
		calendarId,
		tokenHash: secret.tokenHash,
	});

	return {
		ok: true,
		value: {
			calendarId: stored.calendarId,
			feedToken: secret.token,
			createdAt: stored.createdAt,
			rotatedAt: stored.rotatedAt,
		},
	};
};

/** Whether the calendar has a feed address, and how old it is. */
export const findCalendarFeedFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<CalendarFeedStateResponse>> => {
	const calendar = await findCalendarFor(deps, accountConfigId, calendarId);
	if (!calendar.ok) return calendar;

	const stored = await deps.calendarFeedToken.findByCalendar(
		accountConfigId,
		calendarId,
	);
	if (!stored) {
		return refuseCalendar("NotFound", `no feed on calendar ${calendarId}`);
	}
	return { ok: true, value: toFeedState(stored) };
};

/**
 * Revokes the calendar's feed address.
 *
 * A calendar with no feed is refused rather than answered 204: the caller asked
 * for a subscription to stop working, and reporting success for one that was
 * never there reads as confirmation that it has.
 */
export const revokeCalendarFeedFor = async (
	deps: CalendarDeps,
	accountConfigId: string,
	calendarId: string,
): Promise<CalendarOutcome<null>> => {
	const calendar = await findCalendarFor(deps, accountConfigId, calendarId);
	if (!calendar.ok) return calendar;

	const stored = await deps.calendarFeedToken.findByCalendar(
		accountConfigId,
		calendarId,
	);
	if (!stored) {
		return refuseCalendar("NotFound", `no feed on calendar ${calendarId}`);
	}

	await deps.calendarFeedToken.delete(accountConfigId, calendarId);
	return { ok: true, value: null };
};

/**
 * No feed answers to this address.
 *
 * One answer for an unknown token, a revoked one and a malformed one, with a
 * body that says the same thing to all three: a caller probing addresses learns
 * only whether the one it sent works, which is what it was going to find out
 * anyway.
 */
const feedNotFound = (): RawApiResponse =>
	rawApiResponse({
		statusCode: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
		body: "no calendar feed at this address\n",
	});

/**
 * Serves a calendar to whoever holds its secret address.
 *
 * The token is the whole credential, so the checks run in the order that leaks
 * least: a token that cannot be one is refused before anything is hashed, the
 * digest of what arrived is what the store is asked about, and the row it hands
 * back is confirmed against that digest in constant time before a single event
 * is read.
 *
 * A row whose collection is gone is the same 404. It should not exist — a
 * calendar's delete takes its token with it, in one transaction — and serving a
 * blank calendar for one would be worse than saying nothing.
 */
export const serveCalendarFeed = async (
	deps: CalendarDeps,
	feedToken: string,
	ifNoneMatch: string | undefined,
): Promise<RawApiResponse> => {
	if (!isCalendarFeedToken(feedToken)) return feedNotFound();

	const presentedHash = hashCalendarFeedToken(feedToken);
	const stored = await deps.calendarFeedToken.findByTokenHash(presentedHash);
	if (!stored) return feedNotFound();
	if (!calendarFeedTokenMatches(presentedHash, stored.tokenHash)) {
		return feedNotFound();
	}

	const collections = await deps.calendarCollection.listByAccountConfig(
		stored.accountConfigId,
	);
	const collection = collections.find(
		(candidate) => candidate.calendarId === stored.calendarId,
	);
	if (!collection) return feedNotFound();

	const objects = await deps.calendarObject.listByCalendar(stored.calendarId);
	const feed = buildCalendarFeed(collection, objects);
	const etag = `"${feed.etag}"`;

	if (calendarFeedIsUnchanged(ifNoneMatch, feed.etag)) {
		return rawApiResponse({
			statusCode: 304,
			headers: { ETag: etag },
			body: "",
		});
	}

	return rawApiResponse({
		statusCode: 200,
		headers: {
			"Content-Type": "text/calendar; charset=utf-8",
			ETag: etag,
			"Last-Modified": new Date(feed.lastModifiedAt).toUTCString(),
		},
		body: feed.icalData,
	});
};

export const CalendarFeedDetailOperations: Record<
	CalendarFeedDetailOperationIds,
	OperationHandler<CalendarDetailOperationIds>
> = {
	CalendarDetailOperations_getCalendarFeed: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const deps = calendarDepsOf(await getClient());

		const found = await findCalendarFeedFor(deps, accountConfigId, calendarId);
		if (!found.ok) return notFound(found.error.message);
		return found.value;
	},

	CalendarDetailOperations_putCalendarFeed: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const deps = calendarDepsOf(await getClient());

		const minted = await putCalendarFeedFor(deps, accountConfigId, calendarId);
		if (!minted.ok) return notFound(minted.error.message);
		return minted.value;
	},

	CalendarDetailOperations_revokeCalendarFeed: async (
		context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { calendarId } = context.request.params as { calendarId: string };
		const deps = calendarDepsOf(await getClient());

		const revoked = await revokeCalendarFeedFor(
			deps,
			accountConfigId,
			calendarId,
		);
		if (!revoked.ok) return notFound(revoked.error.message);
		return { statusCode: 204 };
	},
};

export const CalendarFeedOperations: Record<
	CalendarFeedOperationIds,
	OperationHandler<CalendarFeedOperationIds>
> = {
	CalendarFeedOperations_getCalendarFeedIcal: async (context) => {
		const { feedToken } = context.request.params as { feedToken: string };
		const ifNoneMatch = context.request.headers["if-none-match"];
		const deps = calendarDepsOf(await getClient());

		return serveCalendarFeed(
			deps,
			feedToken,
			typeof ifNoneMatch === "string" ? ifNoneMatch : undefined,
		);
	},
};
