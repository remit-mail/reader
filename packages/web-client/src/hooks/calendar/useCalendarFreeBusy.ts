/**
 * Busy time over a window, merged across every calendar the account holds.
 *
 * Not the same question as "what is on the strip". A calendar the reader has
 * unticked still takes their Thursday afternoon, so "am I free" is answered off
 * this and never off the rows on screen. The server does the merging, so two
 * overlapping meetings in two calendars are one span here, and an event marked
 * transparent or cancelled is not one at all.
 *
 * The endpoint takes no calendar filter, on purpose: narrowing it would answer
 * a question nobody asked. It carries the same refusals as the window read — a
 * window the server will not accept is stated in place, and a lapsed session
 * escalates rather than being drawn as a clear diary.
 */
import { calendarFreeBusyOperationsListCalendarFreeBusyOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapCalendarFreeBusySpan } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { softErrorStatuses } from "@/lib/error-classifier";
import { CALENDAR_WINDOW_STALE_TIME } from "./useCalendarEvents";
import type { CalendarWindow } from "./window";

const CALENDAR_READ_META = softErrorStatuses(400, 404);

export interface CalendarFreeBusyResult {
	spans: RemitImapCalendarFreeBusySpan[];
	/** Windows whose answer has not arrived, by their `from`. */
	pendingWindows: Set<string>;
	error: unknown;
	refetch: () => void;
}

/**
 * Busy time a window at a time, for the same reason the events are read that
 * way: this endpoint refuses a window over a year too, so a range that grows
 * as the reader scrolls cannot be one request.
 */
export function useCalendarFreeBusyWeeks(
	windows: readonly CalendarWindow[],
): CalendarFreeBusyResult {
	const results = useQueries({
		queries: windows.map((window) => ({
			...calendarFreeBusyOperationsListCalendarFreeBusyOptions({
				query: { from: window.from, to: window.to },
			}),
			meta: CALENDAR_READ_META,
			staleTime: CALENDAR_WINDOW_STALE_TIME,
		})),
	});

	const froms = windows.map((window) => window.from).join("|");
	const settled = results.map((result) => result.data);
	const pendingKey = results.map((result) => result.isPending).join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined keys stand for the per-window results, which are a new array every render
	const spans = useMemo(
		() => settled.flatMap((data) => data?.items ?? []),
		[froms, pendingKey],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: as above
	const pendingWindows = useMemo(() => {
		const pending = new Set<string>();
		windows.forEach((window, index) => {
			if (results[index]?.isPending) pending.add(window.from);
		});
		return pending;
	}, [froms, pendingKey]);

	return {
		spans,
		pendingWindows,
		error: results.find((result) => result.error)?.error ?? null,
		refetch: () => {
			for (const result of results) {
				if (result.error) result.refetch();
			}
		},
	};
}
