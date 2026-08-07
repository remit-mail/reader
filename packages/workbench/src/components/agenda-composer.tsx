/**
 * Typing is the create path here, so the field is on screen at all times and
 * the form is downstream of it.
 *
 * Every keystroke re-reads the sentence and writes the reading straight into
 * the fields underneath, attributed to the words it came from. Where the
 * sentence has two honest readings — which Friday, eight in the morning or
 * eight at night — the reader asks instead of choosing, and the answer is one
 * tap. Correcting the machine happens before the event exists.
 */
import {
	type CalendarDescriptor,
	cn,
	type EventDraft,
	EventEditor,
} from "@remit/ui";
import { AlertTriangle, Info, Wand2 } from "lucide-react";
import type { AgendaParse, ChoicePicks } from "../lib/agenda-phrase.js";
import { formatShortDay } from "../lib/agenda-time.js";

export interface AgendaComposerProps {
	phrase: string;
	onPhraseChange: (phrase: string) => void;
	parse: AgendaParse;
	picks: ChoicePicks;
	onPick: (choiceId: string, optionId: string) => void;
	draft: EventDraft;
	onDraftChange: (draft: EventDraft) => void;
	calendars: CalendarDescriptor[];
	expanded: boolean;
	onToggleExpanded: () => void;
	onSave: () => void;
	onCancel: () => void;
	saveLabel?: string;
	/** The form is folded away until there is something to correct. */
	open: boolean;
	onOpen: () => void;
	placeholder?: string;
	touch?: boolean;
	className?: string;
}

export function AgendaComposer({
	phrase,
	onPhraseChange,
	parse,
	picks,
	onPick,
	draft,
	onDraftChange,
	calendars,
	expanded,
	onToggleExpanded,
	onSave,
	onCancel,
	saveLabel = "Add",
	open,
	onOpen,
	placeholder = "lunch with Jane friday 1pm",
	touch,
	className,
}: AgendaComposerProps) {
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<div
				className={cn(
					"flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30",
					touch ? "min-h-11" : "h-9",
				)}
			>
				<Wand2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<input
					value={phrase}
					aria-label="Describe the event"
					placeholder={placeholder}
					onFocus={onOpen}
					onChange={(event) => {
						onOpen();
						onPhraseChange(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") onSave();
					}}
					className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>

			{open && (
				<EventEditor
					draft={draft}
					onChange={onDraftChange}
					calendars={calendars}
					expanded={expanded}
					onToggleExpanded={onToggleExpanded}
					onSave={onSave}
					onCancel={onCancel}
					saveLabel={saveLabel}
					touch={touch}
					header={
						phrase.trim() === "" ? undefined : (
							<PhraseReading
								parse={parse}
								picks={picks}
								onPick={onPick}
								touch={touch}
							/>
						)
					}
				/>
			)}
		</div>
	);
}

function PhraseReading({
	parse,
	picks,
	onPick,
	touch,
}: {
	parse: AgendaParse;
	picks: ChoicePicks;
	onPick: (choiceId: string, optionId: string) => void;
	touch?: boolean;
}) {
	const when =
		parse.startTime === ""
			? formatShortDay(parse.date)
			: `${formatShortDay(parse.date)} ${parse.startTime} – ${parse.endTime}`;

	return (
		<div className="flex flex-col gap-1 rounded-md border border-line bg-surface px-2.5 py-2">
			<Reading
				label="What"
				value={parse.title === "" ? "—" : parse.title}
				source=""
			/>
			<Reading
				label="When"
				value={when}
				source={[parse.dateText, parse.startTimeText]
					.filter((part) => part !== "")
					.join(" ")}
			/>
			{parse.repeat !== "" && (
				<Reading
					label="Repeat"
					value={parse.repeat}
					source={parse.repeatText}
				/>
			)}
			{parse.attendees.length > 0 && (
				<Reading
					label="Who"
					value={parse.attendees.join(", ")}
					source={parse.attendeesText}
				/>
			)}
			{parse.location !== "" && (
				<Reading
					label="Where"
					value={parse.location}
					source={parse.locationText}
				/>
			)}

			{parse.choices.map((choice) => (
				<div
					key={choice.id}
					className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-warning/50 bg-warning-soft/30 px-2 py-1.5"
				>
					<AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden />
					<span className="text-2xs text-warning">{choice.question}</span>
					{choice.options.map((option) => {
						const chosen = (picks[choice.id] ?? choice.chosenId) === option.id;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={chosen}
								onClick={() => onPick(choice.id, option.id)}
								className={cn(
									"rounded-full border px-2 text-2xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
									touch ? "min-h-9" : "h-6",
									chosen
										? "border-warning bg-warning-soft font-medium text-warning"
										: "border-line text-fg-muted hover:border-line-strong hover:text-fg",
								)}
							>
								{option.label}
							</button>
						);
					})}
				</div>
			))}

			{parse.assumptions.map((note) => (
				<p
					key={note}
					className="flex items-center gap-1.5 text-2xs text-fg-subtle"
				>
					<Info className="size-3 shrink-0" aria-hidden />
					{note}
				</p>
			))}
			{parse.unresolved.map((note) => (
				<p
					key={note}
					className="flex items-center gap-1.5 text-2xs text-warning"
				>
					<AlertTriangle className="size-3 shrink-0" aria-hidden />
					{note}
				</p>
			))}
		</div>
	);
}

function Reading({
	label,
	value,
	source,
}: {
	label: string;
	value: string;
	source: string;
}) {
	return (
		<div className="flex min-w-0 items-baseline gap-1.5">
			<span className="w-12 shrink-0 text-2xs uppercase tracking-wider text-fg-subtle">
				{label}
			</span>
			<span className="truncate text-xs font-medium text-fg">{value}</span>
			{source !== "" && (
				<span className="shrink-0 rounded-xs bg-accent-2-soft px-1 text-2xs text-accent-2">
					{source}
				</span>
			)}
		</div>
	);
}
