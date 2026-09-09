import type { EventDraft } from "@remit/ui";
import { useEffect, useState } from "react";
import { CalendarComposePane } from "@/components/calendar/CalendarComposePane";
import { useCalendarComposeSeed } from "@/components/calendar/CalendarComposeSeed";
import {
	createInputFromDraft,
	emptyDraft,
	UNZONED_CALENDAR,
	useCalendars,
	useCalendarWrites,
} from "@/hooks/calendar";
import { useCalendarAddress } from "@/routing";

/**
 * Writing a new event.
 *
 * The draft starts on the slot the reader dragged out of the grid, or on the
 * day the calendar is showing when they opened the composer some other way. The
 * write goes through the same service function every other path uses, so an
 * event typed here, one accepted from an invitation and one written over CalDAV
 * are the same bytes stored the same way.
 */
export interface WriteCalendarEventProps {
	onClose: () => void;
}

export function WriteCalendarEvent({ onClose }: WriteCalendarEventProps) {
	const { date } = useCalendarAddress();
	const seed = useCalendarComposeSeed();
	const { calendars, timeZoneByCalendarId } = useCalendars();
	const { createEvent, isWriting } = useCalendarWrites();
	const [problem, setProblem] = useState("");
	const [draft, setDraft] = useState<EventDraft>(() => {
		const blank = emptyDraft(seed?.date ?? date, "");
		if (!seed) return blank;
		return {
			...blank,
			allDay: seed.allDay,
			startTime: seed.allDay ? "" : seed.startTime,
			endTime: seed.allDay ? "" : seed.endTime,
		};
	});

	// The default calendar is provisioned by the listing itself, so the picker
	// has one the moment the calendars arrive rather than making the reader
	// choose before they can type anything.
	const firstCalendarId = calendars[0]?.id ?? "";
	useEffect(() => {
		if (firstCalendarId === "") return;
		setDraft((current) =>
			current.calendarId === ""
				? { ...current, calendarId: firstCalendarId }
				: current,
		);
	}, [firstCalendarId]);

	const save = () => {
		const built = createInputFromDraft(
			draft,
			timeZoneByCalendarId[draft.calendarId] ?? UNZONED_CALENDAR,
		);
		if (!built.ok) {
			setProblem(built.problem);
			return;
		}
		void createEvent(built.input).then((outcome) => {
			if (outcome.kind === "written") {
				setProblem("");
				onClose();
				return;
			}
			setProblem(
				outcome.kind === "conflict"
					? "This calendar changed while you were writing. Close the form and try again."
					: outcome.message,
			);
		});
	};

	return (
		<CalendarComposePane
			title="New event"
			subtitle={draft.date}
			calendars={calendars}
			draft={draft}
			onChange={setDraft}
			problem={problem}
			saveLabel="Add"
			isSaving={isWriting}
			onSave={save}
			onCancel={onClose}
		/>
	);
}
