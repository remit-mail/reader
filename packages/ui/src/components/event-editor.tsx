import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import type { CalendarDescriptor, EventDraft } from "./calendar-types.js";
import { Input } from "./input.js";

export interface EventEditorProps {
	draft: EventDraft;
	onChange: (draft: EventDraft) => void;
	calendars: CalendarDescriptor[];
	/** The folded section is open. The caller owns it so a story can start open. */
	expanded: boolean;
	onToggleExpanded: () => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete?: () => void;
	saveLabel?: string;
	/** Sits above the fields — the quick-entry field, or a scope reminder. */
	header?: ReactNode;
	/** Grows the controls for a bottom sheet. */
	touch?: boolean;
	className?: string;
}

/**
 * Three fields make an event: what, when, and which calendar. Everything else
 * — where, who, notes, repeat — is real and reachable but folded, because the
 * common case is a title and a time and the form should cost what that costs.
 */
export function EventEditor({
	draft,
	onChange,
	calendars,
	expanded,
	onToggleExpanded,
	onSave,
	onCancel,
	onDelete,
	saveLabel = "Add",
	header,
	touch,
	className,
}: EventEditorProps) {
	const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
		onChange({ ...draft, [key]: value });
	const fieldHeight = touch ? "min-h-11" : "";

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{header}

			<Input
				value={draft.title}
				placeholder="Title"
				aria-label="Title"
				onChange={(e) => set("title", e.target.value)}
				className={cn("text-md font-medium", fieldHeight)}
			/>

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

			<CalendarPicker
				calendars={calendars}
				value={draft.calendarId}
				onChange={(id) => set("calendarId", id)}
				touch={touch}
			/>

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

			{expanded && (
				<div className="flex flex-col gap-2 border-t border-line pt-3">
					<Input
						value={draft.location}
						placeholder="Location"
						aria-label="Location"
						onChange={(e) => set("location", e.target.value)}
						className={fieldHeight}
					/>
					<Input
						value={draft.guests}
						placeholder="Guests, comma separated"
						aria-label="Guests"
						onChange={(e) => set("guests", e.target.value)}
						className={fieldHeight}
					/>
					<Input
						value={draft.repeat}
						placeholder="Repeat, e.g. every weekday"
						aria-label="Repeat"
						onChange={(e) => set("repeat", e.target.value)}
						className={fieldHeight}
					/>
					<textarea
						value={draft.notes}
						placeholder="Notes"
						aria-label="Notes"
						onChange={(e) => set("notes", e.target.value)}
						rows={3}
						className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/30"
					/>
				</div>
			)}

			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="primary"
					size={touch ? "md" : "sm"}
					onClick={onSave}
					className={touch ? "min-h-11 flex-1" : ""}
				>
					{saveLabel}
				</Button>
				<Button
					variant="ghost"
					size={touch ? "md" : "sm"}
					onClick={onCancel}
					className={touch ? "min-h-11" : ""}
				>
					Cancel
				</Button>
				{onDelete && (
					<Button
						variant="ghost"
						size={touch ? "md" : "sm"}
						onClick={onDelete}
						className={cn("ml-auto text-danger", touch && "min-h-11")}
					>
						Delete
					</Button>
				)}
			</div>
		</div>
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
