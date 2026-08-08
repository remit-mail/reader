import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { type ReactNode, useId } from "react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import { NO_REPEAT, repeatChoices } from "../lib/recurrence.js";
import { Button } from "./button.js";
import type { CalendarDescriptor, EventDraft } from "./calendar-types.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

export interface EventEditorProps {
	draft: EventDraft;
	onChange: (draft: EventDraft) => void;
	calendars: CalendarDescriptor[];
	/**
	 * `compact` folds everything past the three core fields behind a disclosure,
	 * for a bottom sheet or a rail. `pane` has the room to show the whole event
	 * at once and labels every field.
	 */
	layout?: "compact" | "pane";
	/** The folded section is open. The caller owns it so a story can start open. */
	expanded?: boolean;
	/** Absent means there is no fold: every field is on screen. */
	onToggleExpanded?: () => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	saveLabel?: string;
	/** Sits above the fields — the quick-entry field, or a scope reminder. */
	header?: ReactNode;
	/**
	 * The rule belongs to the series, not to one morning of it. An edit scoped to
	 * a single instance reads the rule back instead of offering to change it.
	 */
	repeatEditable?: boolean;
	/** Grows the controls for a bottom sheet. */
	touch?: boolean;
	className?: string;
}

/**
 * Three fields make an event: what, when, and which calendar. Everything else
 * — where, who, notes, repeat — is real and reachable, folded away where the
 * form is a sheet and open where the form is a pane, because a fold buys room
 * only where room is scarce.
 */
export function EventEditor({
	draft,
	onChange,
	calendars,
	layout = "compact",
	expanded = false,
	onToggleExpanded,
	onSave,
	onCancel,
	onDelete,
	saveLabel = "Add",
	header,
	repeatEditable = true,
	touch,
	className,
}: EventEditorProps) {
	const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
		onChange({ ...draft, [key]: value });
	const fieldHeight = touch ? "min-h-11" : "";
	const roomy = layout === "pane";
	const notesClass =
		"w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/30";

	const title = (
		<Input
			value={draft.title}
			placeholder="Title"
			aria-label="Title"
			onChange={(e) => set("title", e.target.value)}
			className={cn(
				roomy ? "text-lg font-medium" : "text-md font-medium",
				roomy ? "h-11" : fieldHeight,
			)}
		/>
	);

	const when = (
		<div className="flex flex-wrap items-center gap-2">
			<Input
				type="date"
				value={draft.date}
				aria-label="Date"
				onChange={(e) => set("date", e.target.value)}
				className={cn("w-40", fieldHeight)}
			/>
			{draft.allDay ? (
				<span className="text-sm text-fg-muted">All day</span>
			) : (
				<>
					<Input
						type="time"
						value={draft.startTime}
						aria-label="Start time"
						onChange={(e) => set("startTime", e.target.value)}
						className={cn("w-28", fieldHeight)}
					/>
					<span className="text-sm text-fg-subtle">to</span>
					<Input
						type="time"
						value={draft.endTime}
						aria-label="End time"
						onChange={(e) => set("endTime", e.target.value)}
						className={cn("w-28", fieldHeight)}
					/>
				</>
			)}
			<label className="flex items-center gap-2 text-sm text-fg-muted">
				<input
					type="checkbox"
					checked={draft.allDay}
					onChange={(e) => set("allDay", e.target.checked)}
					className="size-4 accent-current"
				/>
				All day
			</label>
		</div>
	);

	const calendarPicker = (
		<CalendarPicker
			calendars={calendars}
			value={draft.calendarId}
			onChange={(id) => set("calendarId", id)}
			touch={touch}
		/>
	);

	const repeat = repeatEditable ? (
		<RepeatPicker
			value={draft.repeat}
			date={draft.date}
			startTime={draft.startTime}
			onChange={(next) => set("repeat", next)}
			className={fieldHeight}
		/>
	) : (
		<p className="flex items-center gap-2 text-sm text-fg-muted">
			<Repeat className="size-4 shrink-0 text-fg-subtle" aria-hidden />
			{draft.repeat === NO_REPEAT ? "Does not repeat" : draft.repeat}
		</p>
	);

	const location = (
		<Input
			value={draft.location}
			placeholder="Location"
			aria-label="Location"
			onChange={(e) => set("location", e.target.value)}
			className={fieldHeight}
		/>
	);

	const guests = (
		<Input
			value={draft.guests}
			placeholder="Guests, comma separated"
			aria-label="Guests"
			onChange={(e) => set("guests", e.target.value)}
			className={fieldHeight}
		/>
	);

	const actions = (
		<div className={cn("flex items-center gap-2", roomy ? "pt-2" : "pt-1")}>
			<Button
				variant="primary"
				size={touch || roomy ? "md" : "sm"}
				onClick={onSave}
				className={touch ? "min-h-11 flex-1" : ""}
			>
				{saveLabel}
			</Button>
			<Button
				variant="ghost"
				size={touch || roomy ? "md" : "sm"}
				onClick={onCancel}
				className={touch ? "min-h-11" : ""}
			>
				Cancel
			</Button>
			{onDelete && (
				<Button
					variant="ghost"
					size={touch || roomy ? "md" : "sm"}
					onClick={onDelete}
					className={cn("ml-auto text-danger", touch && "min-h-11")}
				>
					Delete
				</Button>
			)}
		</div>
	);

	if (roomy) {
		return (
			<div className={cn("flex flex-col gap-5", className)}>
				{header}
				<Field label="Title">{title}</Field>
				<Field label="When">{when}</Field>
				<Field label="Calendar">{calendarPicker}</Field>
				<Field label="Repeat">{repeat}</Field>
				<Field label="Location">{location}</Field>
				<Field label="Guests">{guests}</Field>
				<Field label="Notes">
					<textarea
						value={draft.notes}
						placeholder="Notes"
						aria-label="Notes"
						onChange={(e) => set("notes", e.target.value)}
						rows={6}
						className={notesClass}
					/>
				</Field>
				{actions}
			</div>
		);
	}

	const folded = onToggleExpanded !== undefined && !expanded;

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{header}

			{title}
			{when}
			{calendarPicker}

			{onToggleExpanded && (
				<button
					type="button"
					onClick={onToggleExpanded}
					aria-expanded={expanded}
					className={cn(
						"flex items-center gap-1 self-start rounded-sm text-xs font-medium text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
						touch && "min-h-11",
					)}
				>
					{expanded ? (
						<ChevronDown className="size-3.5" />
					) : (
						<ChevronRight className="size-3.5" />
					)}
					{expanded ? "Fewer details" : "More details"}
				</button>
			)}

			{!folded && (
				<div className="flex flex-col gap-2 border-t border-line pt-3">
					{location}
					{guests}
					{repeat}
					<textarea
						value={draft.notes}
						placeholder="Notes"
						aria-label="Notes"
						onChange={(e) => set("notes", e.target.value)}
						rows={3}
						className={notesClass}
					/>
				</div>
			)}

			{actions}
		</div>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</span>
			{children}
		</div>
	);
}

/**
 * The rules a date can repeat by, plus whatever rule the event already carries.
 * A rule read out of a mail or typed in a sentence is kept verbatim rather than
 * snapped to the nearest offer — the picker never silently rewrites a rule.
 */
function RepeatPicker({
	value,
	date,
	startTime,
	onChange,
	className,
}: {
	value: string;
	date: string;
	startTime: string;
	onChange: (repeat: string) => void;
	className?: string;
}) {
	const offered = repeatChoices(date, startTime);
	const choices =
		value === NO_REPEAT || offered.includes(value)
			? offered
			: [value, ...offered];

	return (
		<Select
			icon={<Repeat className="size-4" />}
			aria-label="Repeat"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={className}
		>
			<option value={NO_REPEAT}>Does not repeat</option>
			{choices.map((choice) => (
				<option key={choice} value={choice}>
					{choice}
				</option>
			))}
		</Select>
	);
}

function CalendarPicker({
	calendars,
	value,
	onChange,
	touch,
}: {
	calendars: CalendarDescriptor[];
	value: string;
	onChange: (calendarId: string) => void;
	touch?: boolean;
}) {
	const group = useId();
	return (
		<fieldset className="flex flex-wrap gap-1.5">
			<legend className="sr-only">Calendar</legend>
			{calendars.map((calendar) => {
				const hue = calendarColorClasses(calendar.color);
				const active = calendar.id === value;
				return (
					<label
						key={calendar.id}
						className={cn(
							"inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
							"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
							touch ? "min-h-11" : "h-7",
							active
								? cn(hue.soft, hue.text, hue.border)
								: "border-line text-fg-muted hover:bg-surface-sunken",
						)}
					>
						<input
							type="radio"
							name={group}
							value={calendar.id}
							checked={active}
							onChange={() => onChange(calendar.id)}
							className="sr-only"
						/>
						<span className={cn("size-2 rounded-full", hue.solid)} />
						{calendar.name}
					</label>
				);
			})}
		</fieldset>
	);
}
