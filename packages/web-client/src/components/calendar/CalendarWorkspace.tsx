import {
	type CalendarColorId,
	CalendarDateNav,
	type CalendarEventData,
	CalendarGrid,
	type CalendarSlotPick,
	type CalendarViewId,
	CalendarViewSwitch,
	type Density,
	segmentClassName,
} from "@remit/ui";
import { useId, useState } from "react";
import { CalendarViewPlaceholder } from "@/components/calendar/CalendarViewPlaceholder";
import { NavMenuButton } from "@/components/mail/NavMenuButton";
import { calendarViewMountsGrid } from "@/lib/calendar-route";

/**
 * The calendar's own pane: the toolbar that moves it and whatever the current
 * zoom draws.
 *
 * Presentational, like everything in `@remit/ui` it is built from. It holds no
 * events, reads no clock and knows no router: prev, next, today and the zoom
 * switch all leave through callbacks, and the route turns each one into an
 * address. That is what keeps "which view" and "which day" facts of the URL
 * rather than of this component's state.
 */

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
	{ value: "comfortable", label: "Detail" },
	{ value: "compact", label: "Glance" },
];

export interface CalendarWorkspaceProps {
	view: CalendarViewId;
	/** The day the view is centred on, `YYYY-MM-DD`. */
	date: string;
	events: CalendarEventData[];
	colorByCalendarId: Record<string, CalendarColorId>;
	density: Density;
	/** The event the reading pane has open, empty for none. */
	selectedEventId: string;
	timeZone: string;
	/** The instant the grid calls now. */
	now: string;
	onChangeView: (view: CalendarViewId) => void;
	onToday: () => void;
	onChangeDensity: (density: Density) => void;
	onSelectEvent: (eventId: string) => void;
	onPickSlot: (pick: CalendarSlotPick) => void;
	onStep: (direction: -1 | 1) => void;
}

/**
 * The range the toolbar names before the grid has measured one, and the whole
 * answer at a zoom that draws no grid.
 */
function fallbackRangeTitle(view: CalendarViewId, date: string): string {
	const instant = new Date(`${date}T00:00:00`);
	if (view === "year")
		return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(
			instant,
		);
	if (view === "day")
		return new Intl.DateTimeFormat(undefined, {
			weekday: "short",
			day: "numeric",
			month: "long",
			year: "numeric",
		}).format(instant);
	return new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
	}).format(instant);
}

export function CalendarWorkspace({
	view,
	date,
	events,
	colorByCalendarId,
	density,
	selectedEventId,
	timeZone,
	now,
	onChangeView,
	onToday,
	onChangeDensity,
	onSelectEvent,
	onPickSlot,
	onStep,
}: CalendarWorkspaceProps) {
	const densityGroup = useId();
	// The grid computes the range it drew, which is the only honest title for a
	// week — it knows where the week starts. Held against the address it was
	// measured for, so leaving a view does not carry its title into the next one.
	const [measured, setMeasured] = useState({ key: "", title: "" });
	const addressKey = `${view}/${date}`;
	const title =
		measured.key === addressKey
			? measured.title
			: fallbackRangeTitle(view, date);

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			<div className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-2">
				{/* Below the nav pane the sidebar is a slide-over with nothing to open
				    it: the calendar is a whole surface of its own, so without this
				    the reader has no way back to their mail. */}
				<NavMenuButton />
				<CalendarDateNav
					title={title}
					onPrev={() => onStep(-1)}
					onNext={() => onStep(1)}
					onToday={onToday}
				>
					<fieldset className="inline-flex items-center gap-0.5">
						<legend className="sr-only">Calendar density</legend>
						{DENSITY_OPTIONS.map((option) => (
							<label
								key={option.value}
								className={`${segmentClassName(density === option.value)} h-7 text-xs`}
							>
								<input
									type="radio"
									name={densityGroup}
									value={option.value}
									checked={density === option.value}
									onChange={() => onChangeDensity(option.value)}
									className="sr-only"
								/>
								{option.label}
							</label>
						))}
					</fieldset>
					<CalendarViewSwitch value={view} onChange={onChangeView} />
				</CalendarDateNav>
			</div>

			<div className="min-h-0 flex-1">
				{calendarViewMountsGrid(view) ? (
					<CalendarGrid
						view={view}
						date={date}
						events={events}
						colorByCalendarId={colorByCalendarId}
						density={density}
						selectedEventId={selectedEventId}
						timeZone={timeZone}
						now={now}
						onSelectEvent={onSelectEvent}
						onPickSlot={onPickSlot}
						onRangeChange={(measuredTitle) =>
							setMeasured({ key: addressKey, title: measuredTitle })
						}
					/>
				) : (
					<CalendarViewPlaceholder view={view} />
				)}
			</div>
		</div>
	);
}
