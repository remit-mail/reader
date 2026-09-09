/**
 * One calendar's subscription address, wired to the server (#1067).
 *
 * A component rather than a loop body in the settings route: each calendar
 * reads and writes its own feed, and a hook cannot be called per iteration.
 */
import { CalendarFeedCard } from "@/components/settings/CalendarFeedCard";
import { useCalendarFeed } from "@/hooks/calendar/useCalendarFeed";

export interface CalendarFeedPanelProps {
	calendarId: string;
	calendarName: string;
}

export function CalendarFeedPanel({
	calendarId,
	calendarName,
}: CalendarFeedPanelProps) {
	const feed = useCalendarFeed(calendarId);

	return (
		<CalendarFeedCard
			calendarName={calendarName}
			state={feed.state}
			mintedUrl={feed.mintedUrl}
			isBusy={feed.isBusy}
			actionError={feed.actionError}
			onMint={feed.mint}
			onRevoke={feed.revoke}
			onDismissMinted={feed.dismissMinted}
			onRetry={feed.retry}
		/>
	);
}
