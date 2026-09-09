import {
	type CalendarDescriptor,
	type EventDraft,
	EventEditor,
	EventEditorPane,
} from "@remit/ui";
import { AlertCircle } from "lucide-react";

/**
 * Writing an event, and editing one.
 *
 * Presentational, like the pane it sits beside: it holds no draft of its own
 * and saves nothing. The route owns the draft and the write, so this renders
 * the same form whichever of the two the address named.
 *
 * Guests are left out because the calendar store has nowhere to put them yet,
 * which is the kit's default. A field that takes names and drops them is worse
 * than no field: the reader only finds out afterwards, from an event with
 * nobody on it.
 */
export interface CalendarComposePaneProps {
	/** What the pane is doing: "New event", "Edit event". */
	title: string;
	/** The one line of context the title cannot carry — which day, which series. */
	subtitle?: string;
	calendars: CalendarDescriptor[];
	draft: EventDraft;
	onChange: (draft: EventDraft) => void;
	/**
	 * Why the last save did not happen, in the words the reader needs: what was
	 * refused and what to do about it. Empty when nothing has been refused.
	 */
	problem: string;
	saveLabel: string;
	isSaving: boolean;
	/**
	 * The rule belongs to the series rather than to one morning of it, so an
	 * edit scoped to a single occurrence reads it back instead of offering it.
	 */
	repeatEditable?: boolean;
	/**
	 * Whether the event can still be sent to a different calendar. Writing one
	 * chooses; editing one cannot, because the collection a resource lives in is
	 * part of its address and the patch has no field for it.
	 */
	calendarEditable?: boolean;
	onSave: () => void;
	onCancel: () => void;
}

export function CalendarComposePane({
	title,
	subtitle,
	calendars,
	draft,
	onChange,
	problem,
	saveLabel,
	isSaving,
	repeatEditable = true,
	calendarEditable = true,
	onSave,
	onCancel,
}: CalendarComposePaneProps) {
	return (
		<EventEditorPane title={title} subtitle={subtitle} onClose={onCancel}>
			<EventEditor
				draft={draft}
				onChange={onChange}
				calendars={calendars}
				layout="pane"
				repeatEditable={repeatEditable}
				calendarEditable={calendarEditable}
				saveLabel={isSaving ? "Saving…" : saveLabel}
				onSave={onSave}
				onCancel={onCancel}
				header={
					problem === "" ? undefined : (
						<div
							role="alert"
							className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm"
						>
							<AlertCircle
								className="mt-0.5 size-4 shrink-0 text-danger"
								aria-hidden="true"
							/>
							<p className="min-w-0 flex-1 break-words text-fg">{problem}</p>
						</div>
					)
				}
			/>
		</EventEditorPane>
	);
}
