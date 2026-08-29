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
import { useQuery } from "@tanstack/react-query";
import { softErrorStatuses } from "@/lib/error-classifier";
import type { CalendarWindow } from "./window";

const CALENDAR_READ_META = softErrorStatuses(400, 404);

export interface CalendarFreeBusyResult {
	spans: RemitImapCalendarFreeBusySpan[];
	isLoading: boolean;
	/** A refusal the surface renders inline. Null when the read succeeded. */
	error: unknown;
}

export function useCalendarFreeBusy(
	window: CalendarWindow,
): CalendarFreeBusyResult {
	const { data, isLoading, error } = useQuery({
		...calendarFreeBusyOperationsListCalendarFreeBusyOptions({
			query: { from: window.from, to: window.to },
		}),
		meta: CALENDAR_READ_META,
	});

	return { spans: data?.items ?? [], isLoading, error };
}
