// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /calendar/{view}/{date} — the calendar, at one zoom, on one day.
 *
 * Both are path segments. The five zooms are mutually exclusive and each is a
 * different surface, so sibling routes cannot both match (R5); the day is a
 * segment because the strip is infinite and the address has to name where it
 * opened — a `?date=` param would be the query compensating for a missing
 * segment (R4).
 *
 * A segment the calendar cannot read is rewritten rather than refused. A
 * hand-edited or stale address is a normal thing to receive, and the half that
 * was readable is kept, so `/calendar/fortnight/2026-06-10` lands on that day's
 * week instead of on an error.
 */
import type { CalendarSlotPick } from "@remit/ui";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AgendaView } from "@/components/calendar/AgendaView";
import { CalendarComposeSeedProvider } from "@/components/calendar/CalendarComposeSeed";
import { CalendarShell } from "@/components/calendar/CalendarShell";
import { CalendarWorkspace } from "@/components/calendar/CalendarWorkspace";
import { calendarInstanceId, deviceTimeZone } from "@/hooks/calendar";
import { useCalendarData } from "@/hooks/useCalendarData";
import {
	readCalendarDensity,
	writeCalendarDensity,
} from "@/lib/calendar-density";
import {
	calendarSearchSchema,
	calendarViewMountsAgenda,
	canonicalCalendarParams,
	isoDate,
} from "@/lib/calendar-route";
import {
	useCalendarAddress,
	useCalendarNavigation,
	useIsWritingEvent,
	useOpenCalendarEvent,
} from "@/routing";

export const Route = createFileRoute("/calendar/$view/$date")({
	validateSearch: calendarSearchSchema,
	beforeLoad: ({ params, search }) => {
		const canonical = canonicalCalendarParams(params, isoDate(new Date()));
		if (canonical.view === params.view && canonical.date === params.date)
			return;
		throw redirect({
			to: "/calendar/$view/$date",
			params: canonical,
			search,
			replace: true,
		});
	},
	component: CalendarViewLayout,
});

function CalendarViewLayout() {
	const { view, date, calendarIds } = useCalendarAddress();
	// The strip fetches the days it holds a week at a time and draws none of
	// this, so at that zoom the layout asks for nothing: the address rewrites on
	// every scroll, and each rewrite would otherwise fetch a week nobody renders
	// along with the two beside it.
	const drawsGrid = !calendarViewMountsAgenda(view);
	const { events, colorByCalendarId, isLoading, error, retry, instanceOf } =
		useCalendarData({ view, date, calendarIds, enabled: drawsGrid });
	const { goToView, goToToday, step, openEvent, openComposer } =
		useCalendarNavigation();
	const openedEvent = useOpenCalendarEvent();
	const isWriting = useIsWritingEvent();
	// Held in state rather than read back from storage each render: how much of
	// a day this device shows is not a fact about the calendar, so changing it
	// changes nothing about the address.
	const [density, setDensity] = useState(readCalendarDensity);
	const changeDensity = useCallback((next: typeof density) => {
		writeCalendarDensity(next);
		setDensity(next);
	}, []);
	const [pick, setPick] = useState<CalendarSlotPick | undefined>(undefined);

	const selectEvent = useCallback(
		(eventId: string) => {
			const instance = instanceOf(eventId);
			openEvent(instance.calendarObjectId, instance.recurrenceId);
		},
		[instanceOf, openEvent],
	);

	const pickSlot = useCallback(
		(slot: CalendarSlotPick) => {
			setPick(slot);
			openComposer();
		},
		[openComposer],
	);

	const workspace = (
		<CalendarWorkspace
			view={view}
			date={date}
			events={events}
			colorByCalendarId={colorByCalendarId}
			agenda={<AgendaView density={density} onPickSlot={pickSlot} />}
			isLoading={isLoading}
			error={error}
			onRetry={retry}
			density={density}
			selectedEventId={
				openedEvent
					? calendarInstanceId(
							openedEvent.calendarObjectId,
							openedEvent.recurrenceId ?? "",
						)
					: ""
			}
			timeZone={deviceTimeZone()}
			now={new Date().toISOString()}
			onChangeView={goToView}
			onToday={goToToday}
			onStep={step}
			onChangeDensity={changeDensity}
			onSelectEvent={selectEvent}
			onPickSlot={pickSlot}
		/>
	);

	return (
		<CalendarComposeSeedProvider pick={pick}>
			<CalendarShell
				workspace={workspace}
				reading={<Outlet />}
				hasOpenEvent={openedEvent !== undefined || isWriting}
			/>
		</CalendarComposeSeedProvider>
	);
}
