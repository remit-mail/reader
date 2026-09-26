/**
 * One calendar on the settings page: its name and zone, deleting it, and its
 * subscription address, wired to the server.
 */
import { type ReactNode, useState } from "react";
import { CalendarDetailsForm } from "@/components/settings/CalendarDetailsForm";
import { CalendarFeedPanel } from "@/components/settings/CalendarFeedPanel";
import {
	type CalendarCollectionOutcome,
	useCalendarCollectionWrites,
} from "@/hooks/calendar/useCalendarCollectionWrites";

export interface CalendarSettingsPanelProps {
	calendarId: string;
	calendarName: string;
	timezone: string;
	/** Where a subscribed calendar comes from, drawn above its details. */
	subscription?: ReactNode;
}

export function CalendarSettingsPanel({
	calendarId,
	calendarName,
	timezone,
	subscription,
}: CalendarSettingsPanelProps) {
	const { updateCalendar, deleteCalendar, isWriting } =
		useCalendarCollectionWrites();
	const [problem, setProblem] = useState("");

	const settle = (outcome: CalendarCollectionOutcome) =>
		setProblem(outcome.kind === "refused" ? outcome.message : "");

	return (
		<CalendarFeedPanel
			calendarId={calendarId}
			calendarName={calendarName}
			details={
				<>
					{subscription}
					<CalendarDetailsForm
						key={`${calendarName}\u0000${timezone}`}
						calendarName={calendarName}
						timezone={timezone}
						isBusy={isWriting}
						problem={problem}
						onSave={(details) => {
							setProblem("");
							void updateCalendar(calendarId, details).then(settle);
						}}
						onDelete={() => {
							setProblem("");
							void deleteCalendar(calendarId).then(settle);
						}}
					/>
				</>
			}
		/>
	);
}
