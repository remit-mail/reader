// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
import { createFileRoute } from "@tanstack/react-router";
import { ChangeCalendarSuggestion } from "@/components/calendar/ChangeCalendarSuggestion";
import { useCalendarNavigation, useChangingSuggestionId } from "@/routing";

function ChangeSuggestionRoute() {
	const suggestionId = useChangingSuggestionId();
	const { closeEvent } = useCalendarNavigation();
	if (suggestionId === undefined) return null;
	return (
		<ChangeCalendarSuggestion
			suggestionId={suggestionId}
			onClose={closeEvent}
		/>
	);
}

export const Route = createFileRoute(
	"/calendar/$view/$date/suggestion/$suggestionId",
)({
	component: ChangeSuggestionRoute,
});
