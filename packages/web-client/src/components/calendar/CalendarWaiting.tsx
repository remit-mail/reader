import {
	CalendarFailureNote,
	CalendarSuggestionDeck,
	type CalendarSuggestionIntel,
	EventSuggestionCard,
	settleZone,
	ZONE_UNSETTLED_REASON,
} from "@remit/ui";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What the mail is still asking about time, beside the calendar it would land
 * on. One reading at a time, as a deck: each is a decision, and the reader
 * makes it with the week in view rather than from a list of them.
 *
 * Presentational. The readings, the answer on its way and the refusal all come
 * in from the host, which reads them off the server.
 */
export interface CalendarWaitingProps {
	suggestions: CalendarSuggestionIntel[];
	/** An answer to the top reading is on its way. */
	busy: boolean;
	/** Why the last answer did not land. Empty when it did. */
	failure: string;
	/** A prefilled issue report for the failure above. */
	reportHref?: string;
	/** Why nothing can be added yet, with the way past it; holds Add. */
	addBlocked?: ReactNode;
	onAdd: (suggestionId: string) => void;
	onDismiss: (suggestionId: string) => void;
}

export function CalendarWaiting({
	suggestions,
	busy,
	failure,
	reportHref,
	addBlocked,
	onAdd,
	onDismiss,
}: CalendarWaitingProps) {
	const top = suggestions[0];
	const settlement = top ? settleZone(top.suggestion, "") : undefined;

	return (
		<aside
			aria-label="Waiting for you"
			className="hidden w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-surface-sunken py-3 lg:flex"
		>
			<h3 className="flex items-center gap-1.5 px-row-inset text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				<Sparkles className="size-3" aria-hidden />
				Waiting for you
			</h3>
			{failure !== "" && (
				<CalendarFailureNote
					text={failure}
					reportHref={reportHref}
					className="mx-row-inset"
				/>
			)}
			{addBlocked !== undefined && (
				<div className="mx-row-inset rounded-md border border-warning/40 bg-warning-soft p-2 text-xs text-fg">
					{addBlocked}
				</div>
			)}
			<CalendarSuggestionDeck
				className="px-row-inset"
				hasCard={top !== undefined}
				remaining={suggestions.length}
				blocked={settlement !== undefined && !settlement.settled}
				blockedReason={ZONE_UNSETTLED_REASON}
				onConfirm={() => {
					if (top && !busy && addBlocked === undefined)
						onAdd(top.suggestion.id);
				}}
				onReject={() => {
					if (top && !busy) onDismiss(top.suggestion.id);
				}}
			>
				{top && (
					<EventSuggestionCard
						suggestion={top.suggestion}
						whenText={top.whenText}
						onAdd={() => onAdd(top.suggestion.id)}
						onDismiss={() => onDismiss(top.suggestion.id)}
						addLabel="Add to calendar"
						busy={busy}
						addBlocked={addBlocked !== undefined}
					/>
				)}
			</CalendarSuggestionDeck>
			<p className="px-row-inset text-2xs text-fg-subtle">
				None of this is on your calendar until you add it. Adding sends the
				organiser nothing.
			</p>
		</aside>
	);
}
