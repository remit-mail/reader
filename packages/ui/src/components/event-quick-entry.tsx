import { AlertTriangle, Info, Wand2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import type { PhraseParse } from "../lib/event-phrase.js";

export interface EventQuickEntryProps {
	value: string;
	onChange: (value: string) => void;
	/** The reading of `value`, recomputed by the caller on every keystroke. */
	parse: PhraseParse;
	/** Commits the reading to the form. */
	onCommit: () => void;
	placeholder?: string;
	touch?: boolean;
	className?: string;
}

interface ReadingProps {
	label: string;
	value: string;
	source: string;
}

function Reading({ label, value, source }: ReadingProps) {
	return (
		<div className="flex min-w-0 items-baseline gap-1.5">
			<span className="shrink-0 text-2xs uppercase tracking-wider text-fg-subtle">
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

/**
 * Typing is the fastest way to make an event, so the field takes a sentence.
 * What it does with the sentence is on screen while you type: every reading is
 * shown next to the words it was taken from, and anything the reader filled in
 * or could not settle is said out loud. Correcting the machine happens before
 * the event exists, not after it is on the grid.
 */
export function EventQuickEntry({
	value,
	onChange,
	parse,
	onCommit,
	placeholder = "lunch with Jane friday 1pm",
	touch,
	className,
}: EventQuickEntryProps) {
	const hasReading = value.trim() !== "";
	const endTime =
		parse.startTime === ""
			? ""
			: ` – ${clockAfter(parse.startTime, parse.durationMinutes)}`;

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
					value={value}
					aria-label="Describe the event"
					placeholder={placeholder}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") onCommit();
					}}
					className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>

			{hasReading && (
				<div className="flex flex-col gap-1 rounded-md border border-line bg-surface px-2.5 py-2">
					<Reading
						label="What"
						value={parse.title === "" ? "—" : parse.title}
						source=""
					/>
					<Reading
						label="When"
						value={`${formatDay(parse.date)}${
							parse.startTime === "" ? "" : ` ${parse.startTime}${endTime}`
						}`}
						source={[parse.dateText, parse.startTimeText]
							.filter((part) => part !== "")
							.join(" ")}
					/>
					{parse.durationText !== "" && (
						<Reading
							label="Long"
							value={formatDuration(parse.durationMinutes)}
							source={parse.durationText}
						/>
					)}
					{parse.attendees.length > 0 && (
						<Reading
							label="Who"
							value={parse.attendees.join(", ")}
							source={parse.attendeesText}
						/>
					)}
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
			)}
		</div>
	);
}

function clockAfter(clock: string, minutes: number): string {
	const [hours, mins] = clock.split(":").map(Number);
	const total = (hours * 60 + mins + minutes) % 1440;
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
		total % 60,
	).padStart(2, "0")}`;
}

function formatDay(iso: string): string {
	if (iso === "") return "—";
	const [year, month, day] = iso.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

function formatDuration(minutes: number): string {
	if (minutes === 0) return "—";
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
