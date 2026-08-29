import {
	AgendaFlow,
	type AgendaScrollTarget,
	type CalendarDay,
	type CalendarDescriptor,
	type CalendarSlotPick,
	type Density,
	NextUpCard,
	readNextUp,
} from "@remit/ui";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import type { FreeLookup } from "@/hooks/calendar";
import { agendaDensityOf } from "@/lib/calendar-density";

/**
 * The agenda, drawn.
 *
 * Presentational, like the rest of the calendar pane: it takes the days it was
 * given, says which one is under the header, and asks for more at either end.
 * What it never does is decide which days those are — the address owns that, and
 * `AgendaView` turns each answer here into one.
 *
 * "What is next" leads today rather than sitting in a rail of its own. It is
 * the question a strip is for, and putting it above today means the reader
 * lands on it and scrolls past it, instead of reading it in a column that is
 * still there when they are three weeks away.
 */

export interface AgendaStripProps {
	/** Contiguous and ascending. */
	days: CalendarDay[];
	calendars: readonly CalendarDescriptor[];
	/** The device preference the whole calendar reads. */
	density: Density;
	today: string;
	/** The day the address names; never collapsed into a run. */
	anchorDate: string;
	/** The instant "what is next" is measured from. */
	now: string;
	selectedEventId: string;
	/** What is still open on a day, measured off merged busy time. */
	freeOn: FreeLookup;
	/** No days have arrived yet. */
	isLoading: boolean;
	/**
	 * A refusal stated in place of the strip. A diary drawn empty because the
	 * read failed is indistinguishable from a diary with nothing in it, which is
	 * the one thing this must never look like.
	 */
	error?: unknown;
	onRetry?: () => void;
	scrollTarget?: AgendaScrollTarget;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	/** Drops out of the list into the day grid. */
	onZoomDay: (date: string) => void;
	onGoToDate: (date: string) => void;
	onReachStart: () => void;
	onReachEnd: () => void;
	/** The day under the sticky header, which the address follows. */
	onVisibleDayChange: (date: string) => void;
}

export function AgendaStrip({
	days,
	calendars,
	density,
	today,
	anchorDate,
	now,
	selectedEventId,
	freeOn,
	isLoading,
	error,
	onRetry,
	scrollTarget,
	onSelectEvent,
	onPickSlot,
	onZoomDay,
	onGoToDate,
	onReachStart,
	onReachEnd,
	onVisibleDayChange,
}: AgendaStripProps) {
	const nextUp = useMemo(() => readNextUp(days, now), [days, now]);

	if (error !== undefined && error !== null)
		return (
			<div className="flex h-full items-center justify-center bg-surface">
				<ErrorState
					title="Couldn't load these days"
					error={error}
					onRetry={onRetry}
				/>
			</div>
		);

	/* Days already on screen stay while more are on the way; only a strip with
	   nothing at all says so, because blank rows read as a free fortnight. */
	if (isLoading && days.length === 0)
		return (
			<div
				role="status"
				aria-label="Loading the agenda"
				className="flex h-full items-center justify-center bg-surface"
			>
				<Loader2 className="size-6 animate-spin text-fg-subtle" />
			</div>
		);

	return (
		<AgendaFlow
			days={days}
			calendars={calendars}
			density={agendaDensityOf(density)}
			today={today}
			focusDate={anchorDate}
			selectedEventId={selectedEventId}
			freeOn={freeOn}
			scrollTarget={scrollTarget}
			onSelectEvent={onSelectEvent}
			onPickSlot={onPickSlot}
			onZoomDay={onZoomDay}
			onReachStart={onReachStart}
			onReachEnd={onReachEnd}
			onVisibleDayChange={onVisibleDayChange}
			todayLead={
				<div className="border-b border-line bg-surface-sunken p-3">
					<NextUpCard
						nextUp={nextUp}
						calendars={calendars}
						today={today}
						onSelectEvent={onSelectEvent}
						onGoTo={onGoToDate}
					/>
				</div>
			}
		/>
	);
}
