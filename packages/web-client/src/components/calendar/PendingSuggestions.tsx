import type { CalendarSuggestionIntel } from "@remit/ui";
import { useState } from "react";
import {
	type SuggestionAnswer,
	useCalendarSuggestionAnswers,
	useCalendars,
	usePendingCalendarSuggestions,
} from "@/hooks/calendar";
import { suggestionWhen, toEventSuggestion } from "@/lib/calendar-suggestion";
import { calendarReportHref } from "@/lib/calendar-report";
import { calendarUnavailable, calendarWriteGate } from "./CalendarUnavailable";
import { CalendarWaiting } from "./CalendarWaiting";

const refusal = (what: string, answer: SuggestionAnswer): string =>
	answer.kind === "refused" ? `Couldn't ${what}: ${answer.message}` : "";

/**
 * Every reading still waiting on the reader, read off the server and answered
 * through it. Nothing is drawn when nothing is waiting: an empty column beside
 * the grid is width the week could have had.
 */
export function PendingSuggestions() {
	const { suggestions, error } = usePendingCalendarSuggestions();
	const calendars = useCalendars();
	const { defaultCalendarId } = calendars;
	const answers = useCalendarSuggestionAnswers();
	const [failure, setFailure] = useState("");

	const deck: CalendarSuggestionIntel[] = suggestions.map((suggestion) => ({
		suggestion: toEventSuggestion(suggestion, {
			threadId: "",
			threadSubject: "",
			calendarId: defaultCalendarId,
			sender:
				suggestion.organizer === "" ? "From your mail" : suggestion.organizer,
		}),
		whenText: suggestionWhen(suggestion),
	}));

	const readFailure =
		error === null ? "" : "Couldn't read what your mail is waiting on.";
	if (deck.length === 0 && readFailure === "" && failure === "") return null;

	const reportHref = calendarReportHref(
		readFailure || failure || "pending invitations could not be answered",
	);

	const answer = (what: string, request: () => Promise<SuggestionAnswer>) => {
		setFailure("");
		void request().then((result) => setFailure(refusal(what, result)));
	};

	return (
		<CalendarWaiting
			suggestions={deck}
			busy={answers.isAnswering}
			failure={readFailure || failure}
			reportHref={reportHref}
			addBlocked={calendarUnavailable(calendarWriteGate(calendars), reportHref)}
			onAdd={(suggestionId) =>
				answer("add this to your calendar", () =>
					answers.accept(suggestionId, defaultCalendarId),
				)
			}
			onDismiss={(suggestionId) =>
				answer("dismiss this", () => answers.dismiss(suggestionId, false))
			}
		/>
	);
}
