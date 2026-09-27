import type { CalendarSuggestionIntel } from "@remit/ui";
import { useState } from "react";
import {
	type SuggestionAnswer,
	useCalendarSuggestionAnswers,
	useCalendars,
	usePendingCalendarSuggestions,
} from "@/hooks/calendar";
import { calendarReportHref } from "@/lib/calendar-report";
import {
	suggestionDate,
	suggestionWhen,
	toEventSuggestion,
} from "@/lib/calendar-suggestion";
import { calendarUnavailable, calendarWriteGate } from "./CalendarUnavailable";
import { CalendarWaiting } from "./CalendarWaiting";

const refusal = (what: string, answer: SuggestionAnswer): string =>
	answer.kind === "refused" ? `Couldn't ${what}: ${answer.message}` : "";

/**
 * Every reading still waiting on the reader, read off the server and answered
 * through it. Nothing is drawn when nothing is waiting: an empty column beside
 * the grid is width the week could have had.
 */
export interface PendingSuggestionsProps {
	onChangeFirst: (suggestionId: string, date: string) => void;
}

export function PendingSuggestions({ onChangeFirst }: PendingSuggestionsProps) {
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

	const changeFirst = (suggestionId: string) => {
		const suggestion = suggestions.find(
			(candidate) => candidate.suggestionId === suggestionId,
		);
		if (suggestion) onChangeFirst(suggestionId, suggestionDate(suggestion));
	};
	const unplaced = (suggestionId: string): boolean => {
		const suggestion = suggestions.find(
			(candidate) => candidate.suggestionId === suggestionId,
		);
		return (
			suggestion?.zoneCertainty === "Ambiguous" &&
			suggestion.method !== "Cancel"
		);
	};
	const topIsCancellation = suggestions[0]?.method === "Cancel";

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
			onAdd={(suggestionId) => {
				if (unplaced(suggestionId)) {
					changeFirst(suggestionId);
					return;
				}
				answer("add this to your calendar", () =>
					answers.accept(suggestionId, defaultCalendarId),
				);
			}}
			onChangeFirst={topIsCancellation ? undefined : changeFirst}
			onDismiss={(suggestionId) =>
				answer("dismiss this", () => answers.dismiss(suggestionId, false))
			}
		/>
	);
}
