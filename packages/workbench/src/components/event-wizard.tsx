/**
 * Making an event on a phone, as a walk rather than a form.
 *
 * A phone has room for one decision at a time, so the create path asks four:
 * what it is, when it is, who is coming, and where it lands. Changing an event
 * that already exists is not a walk — it is usually one field — so the edit is
 * a single page with everything on it.
 */
import {
	type CalendarDescriptor,
	EventCalendarField,
	type EventDraft,
	EventField,
	EventGuestsField,
	EventLocationField,
	EventNotesField,
	EventRepeatField,
	EventTitleField,
	EventWhenField,
} from "@remit/ui";
import type { ReactNode } from "react";

/** The steps a create walks, in order. */
export const EVENT_WIZARD_STEPS = [
	"What",
	"When",
	"Who",
	"Where it lands",
] as const;

export const EVENT_WIZARD_LAST_STEP = EVENT_WIZARD_STEPS.length - 1;

/** Editing a series: the scope question is a step, and it comes first. */
export const SCOPED_EDIT_STEPS = ["Which events", "Edit event"] as const;

/** Editing a one-off: one page, so the rail has nothing to show. */
export const ONE_OFF_EDIT_STEPS = ["Edit event"] as const;

export interface EventWizardStepProps {
	step: number;
	draft: EventDraft;
	onChange: (draft: EventDraft) => void;
	calendars: CalendarDescriptor[];
	repeatEditable?: boolean;
	/** Opens the custom-rule step. Absent leaves the derived choices alone. */
	onCustomRepeat?: () => void;
	/** The sentence field and its reading, above the title on the first step. */
	phrase?: ReactNode;
}

/**
 * One step of the create walk. Every field is the one the pane uses, so the
 * phone and the desktop are the same form asked in a different order.
 */
export function EventWizardStep({
	step,
	draft,
	onChange,
	calendars,
	repeatEditable,
	onCustomRepeat,
	phrase,
}: EventWizardStepProps) {
	const common = { draft, onChange, layout: "pane" as const, touch: true };

	if (step === 0)
		return (
			<div className="flex flex-col gap-5">
				{phrase}
				<EventField label="Title">
					<EventTitleField {...common} />
				</EventField>
			</div>
		);

	if (step === 1)
		return (
			<div className="flex flex-col gap-5">
				<EventField label="When">
					<EventWhenField {...common} />
				</EventField>
				<EventField label="Repeat">
					<EventRepeatField
						{...common}
						repeatEditable={repeatEditable}
						onCustom={onCustomRepeat}
					/>
				</EventField>
			</div>
		);

	if (step === 2)
		return (
			<div className="flex flex-col gap-5">
				<EventField label="Guests">
					<EventGuestsField {...common} />
				</EventField>
				<EventField label="Location">
					<EventLocationField {...common} />
				</EventField>
			</div>
		);

	return (
		<div className="flex flex-col gap-5">
			<EventField label="Calendar">
				<EventCalendarField {...common} calendars={calendars} />
			</EventField>
			<EventField label="Notes">
				<EventNotesField {...common} />
			</EventField>
		</div>
	);
}

export interface EventEditPageProps {
	draft: EventDraft;
	onChange: (draft: EventDraft) => void;
	calendars: CalendarDescriptor[];
	repeatEditable?: boolean;
	onCustomRepeat?: () => void;
}

/** Changing an event: one page, every field, nothing to walk through. */
export function EventEditPage({
	draft,
	onChange,
	calendars,
	repeatEditable,
	onCustomRepeat,
}: EventEditPageProps) {
	const common = { draft, onChange, layout: "pane" as const, touch: true };
	return (
		<div className="flex flex-col gap-5">
			<EventField label="Title">
				<EventTitleField {...common} />
			</EventField>
			<EventField label="When">
				<EventWhenField {...common} />
			</EventField>
			<EventField label="Repeat">
				<EventRepeatField
					{...common}
					repeatEditable={repeatEditable}
					onCustom={onCustomRepeat}
				/>
			</EventField>
			<EventField label="Calendar">
				<EventCalendarField {...common} calendars={calendars} />
			</EventField>
			<EventField label="Guests">
				<EventGuestsField {...common} />
			</EventField>
			<EventField label="Location">
				<EventLocationField {...common} />
			</EventField>
			<EventField label="Notes">
				<EventNotesField {...common} />
			</EventField>
		</div>
	);
}
