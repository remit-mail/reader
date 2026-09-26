import {
	calendarEventDetailOperationsGetCalendarEventOptions,
	calendarEventOperationsListCalendarEventsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getErrorStatus, softErrorStatuses } from "@/lib/error-classifier";
import { type CalendarJump, calendarJumpOf, deviceTimeZone } from "./instance";

export type CalendarJumpSearch =
	| { kind: "Idle" }
	| { kind: "Searching" }
	| { kind: "Found"; jump: CalendarJump }
	| { kind: "Deleted" }
	| { kind: "NoOccurrenceFound" }
	| { kind: "SignedOut" }
	| { kind: "Failed"; reason: string };

const WINDOW_MS = 365 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const LISTING_META = softErrorStatuses(401);
const RESOURCE_META = softErrorStatuses(401, 404);

const instant = (ms: number): string =>
	new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");

const reasonOf = (error: unknown): string => {
	const message =
		error instanceof Error && error.message !== ""
			? error.message
			: "no reason given";
	const status = getErrorStatus(error);
	return status === undefined ? message : `${message} (HTTP ${status})`;
};

/**
 * Finds the day an event falls on when the view on screen does not hold it:
 * its occurrences in the coming year first, and failing those, the year from
 * the resource's own start — so an event that has ended opens at its first.
 */
export function useCalendarJump(
	calendarObjectId: string,
	enabled: boolean,
): CalendarJumpSearch {
	const [now] = useState(() => Date.now());
	const clock = deviceTimeZone();
	const nowIso = new Date(now).toISOString();

	const ahead = useQuery({
		...calendarEventOperationsListCalendarEventsOptions({
			query: {
				from: instant(now),
				to: instant(now + WINDOW_MS),
				calendarObjectId,
			},
		}),
		meta: LISTING_META,
		retry: false,
		enabled,
	});
	const upcoming = ahead.data
		? calendarJumpOf(ahead.data.items, calendarObjectId, nowIso, clock)
		: undefined;

	const lookup = useQuery({
		...calendarEventDetailOperationsGetCalendarEventOptions({
			path: { calendarObjectId },
		}),
		meta: RESOURCE_META,
		retry: false,
		enabled: enabled && ahead.data !== undefined && upcoming === undefined,
	});

	const started = Date.parse(lookup.data?.dtStart ?? "");
	const unreadableStart = lookup.data !== undefined && Number.isNaN(started);
	const firstFrom = Number.isNaN(started) ? 0 : started - DAY_MS;
	const first = useQuery({
		...calendarEventOperationsListCalendarEventsOptions({
			query: {
				from: instant(firstFrom),
				to: instant(firstFrom + WINDOW_MS),
				calendarObjectId,
			},
		}),
		meta: LISTING_META,
		retry: false,
		enabled: enabled && lookup.data !== undefined && !unreadableStart,
	});
	const earliest = first.data
		? calendarJumpOf(first.data.items, calendarObjectId, nowIso, clock)
		: undefined;

	if (!enabled) return { kind: "Idle" };
	if (upcoming) return { kind: "Found", jump: upcoming };
	if (earliest) return { kind: "Found", jump: earliest };

	const deleted = getErrorStatus(lookup.error) === 404;
	const failure = [
		ahead.error,
		deleted ? null : lookup.error,
		first.error,
	].find((error) => error !== null);
	if (failure !== undefined) {
		return getErrorStatus(failure) === 401
			? { kind: "SignedOut" }
			: { kind: "Failed", reason: reasonOf(failure) };
	}
	if (deleted) return { kind: "Deleted" };
	if (unreadableStart)
		return {
			kind: "Failed",
			reason: `the stored event names no readable start (${lookup.data?.dtStart ?? ""})`,
		};
	if (first.data !== undefined) return { kind: "NoOccurrenceFound" };
	return { kind: "Searching" };
}
