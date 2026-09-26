import {
	calendarEventDetailOperationsGetCalendarEventOptions,
	calendarEventOperationsListCalendarEventsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { softErrorStatuses } from "@/lib/error-classifier";
import { type CalendarJump, calendarJumpOf, deviceTimeZone } from "./instance";
import { useCalendars } from "./useCalendars";

/**
 * Finding an event the view on screen does not hold, for an address that names
 * it. Occurrences still to come are asked for first; failing those, the
 * resource is found among the calendars and the year from its start is read,
 * so an event that has ended opens at its first occurrence.
 */
export type CalendarJumpSearch =
	| { kind: "Idle" }
	| { kind: "Searching" }
	| { kind: "Found"; jump: CalendarJump }
	| { kind: "NoOccurrences" }
	| { kind: "Missing" }
	| { kind: "Failed" };

const YEAR_MS = 365 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const RESOURCE_META = softErrorStatuses(404);

const instant = (ms: number): string =>
	new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");

const inCalendars = (calendarIds: readonly string[]) =>
	calendarIds.length === 0 ? {} : { calendarId: [...calendarIds] };

export function useCalendarJump(
	calendarObjectId: string,
	calendarIds: readonly string[],
	enabled: boolean,
): CalendarJumpSearch {
	const [now] = useState(() => Date.now());
	const clock = deviceTimeZone();
	const nowIso = new Date(now).toISOString();
	const { calendars } = useCalendars();

	const ahead = useQuery({
		...calendarEventOperationsListCalendarEventsOptions({
			query: {
				from: instant(now),
				to: instant(now + YEAR_MS),
				...inCalendars(calendarIds),
			},
		}),
		enabled,
	});
	const upcoming = ahead.data
		? calendarJumpOf(ahead.data.items, calendarObjectId, nowIso, clock)
		: undefined;

	const probing = enabled && ahead.data !== undefined && upcoming === undefined;
	const probes = useQueries({
		queries: calendars.map((calendar) => ({
			...calendarEventDetailOperationsGetCalendarEventOptions({
				path: { calendarObjectId },
				query: { calendarId: calendar.id },
			}),
			meta: RESOURCE_META,
			retry: false,
			enabled: probing,
		})),
	});
	const resource = probes.find((probe) => probe.data !== undefined)?.data;
	const probed = probes.every((probe) => probe.status !== "pending");

	const firstFrom = resource ? Date.parse(resource.dtStart) - DAY_MS : 0;
	const first = useQuery({
		...calendarEventOperationsListCalendarEventsOptions({
			query: {
				from: instant(firstFrom),
				to: instant(firstFrom + YEAR_MS),
				calendarId: [resource?.calendarId ?? ""],
			},
		}),
		enabled: probing && resource !== undefined,
	});
	const earliest = first.data
		? calendarJumpOf(first.data.items, calendarObjectId, nowIso, clock)
		: undefined;

	if (!enabled) return { kind: "Idle" };
	if (upcoming) return { kind: "Found", jump: upcoming };
	if (earliest) return { kind: "Found", jump: earliest };
	if (ahead.isError || first.isError) return { kind: "Failed" };
	if (ahead.data === undefined || !probed) return { kind: "Searching" };
	if (resource === undefined) return { kind: "Missing" };
	if (first.data === undefined) return { kind: "Searching" };
	return { kind: "NoOccurrences" };
}
