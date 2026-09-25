import type { IntelligenceCalendarSurface } from "@remit/ui";

/**
 * The calendar half the shipping pane always carries, for a message that says
 * nothing about time. Stories of the Sender half mount it too, so the tab strip
 * they draw is the one the app draws.
 */
export const quietCalendar: IntelligenceCalendarSurface = {
	data: { suggestions: [], day: [], dayLabel: "" },
	actions: {
		onAddInvite: () => undefined,
		onDeclineInvite: () => undefined,
		onOfferOtherTimes: () => undefined,
		onToggleSlot: () => undefined,
		onAddSuggestion: () => undefined,
		onDismissSuggestion: () => undefined,
		onSelectEvent: () => undefined,
	},
};
