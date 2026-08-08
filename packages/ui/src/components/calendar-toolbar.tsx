import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn.js";
import type { CalendarViewId } from "./calendar-types.js";

export interface SegmentOption<T extends string> {
	value: T;
	label: string;
	/** Shown instead of `label` where the control has to fit a thumb. */
	shortLabel: string;
}

/**
 * A flat choice, drawn the way the nav sidebar draws a picked mailbox: weight
 * and hue mark what is on, and nothing is raised. The calendar's toolbar and the
 * nav are the same act — choosing what the pane shows — so they look the same.
 */
export function segmentClassName(active: boolean): string {
	return cn(
		"flex cursor-pointer items-center justify-center rounded-md px-2 font-medium transition-colors",
		"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
		active
			? "bg-accent-2-soft text-accent-2"
			: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
	);
}

export interface SegmentedProps<T extends string> {
	options: SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
	/** Grows every segment to a 44px touch target. */
	touch?: boolean;
	ariaLabel: string;
	className?: string;
}

function Segmented<T extends string>({
	options,
	value,
	onChange,
	touch,
	ariaLabel,
	className,
}: SegmentedProps<T>) {
	const group = useId();
	return (
		<fieldset className={cn("inline-flex items-center gap-0.5", className)}>
			<legend className="sr-only">{ariaLabel}</legend>
			{options.map((option) => (
				<label
					key={option.value}
					className={cn(
						segmentClassName(value === option.value),
						touch ? "min-h-11 flex-1 text-sm" : "h-7 text-xs",
					)}
				>
					<input
						type="radio"
						name={group}
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						className="sr-only"
					/>
					{touch ? option.shortLabel : option.label}
				</label>
			))}
		</fieldset>
	);
}

const VIEW_OPTIONS: SegmentOption<CalendarViewId>[] = [
	{ value: "year", label: "Year", shortLabel: "Y" },
	{ value: "month", label: "Month", shortLabel: "M" },
	{ value: "week", label: "Week", shortLabel: "W" },
	{ value: "day", label: "Day", shortLabel: "D" },
	{ value: "agenda", label: "Agenda", shortLabel: "List" },
];

export interface CalendarViewSwitchProps {
	value: CalendarViewId;
	onChange: (view: CalendarViewId) => void;
	/** Restricts the ladder — a phone has no room for a year grid. */
	views?: CalendarViewId[];
	touch?: boolean;
	className?: string;
}

/**
 * The zoom ladder. Each step keeps the date in view, so moving between them is
 * changing magnification rather than opening a different screen.
 */
export function CalendarViewSwitch({
	value,
	onChange,
	views,
	touch,
	className,
}: CalendarViewSwitchProps) {
	const options = views
		? VIEW_OPTIONS.filter((option) => views.includes(option.value))
		: VIEW_OPTIONS;
	return (
		<Segmented
			ariaLabel="Calendar view"
			options={options}
			value={value}
			onChange={onChange}
			touch={touch}
			className={className}
		/>
	);
}

export interface CalendarDateNavProps {
	/** The range on screen, already formatted. */
	title: string;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	/** Right-hand controls: the view switch, whatever else the view owns. */
	children?: ReactNode;
	touch?: boolean;
}

/**
 * Back, forward, and Today. Today lands on the same target from every view and
 * every distance away, so it is a way home rather than a jump whose result
 * depends on where you were.
 */
export function CalendarDateNav({
	title,
	onPrev,
	onNext,
	onToday,
	children,
	touch,
}: CalendarDateNavProps) {
	const stepClass = cn(
		"flex items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
		touch ? "size-11" : "size-7",
	);
	return (
		<div className="flex min-w-0 items-center gap-2">
			<button
				type="button"
				onClick={onPrev}
				aria-label="Previous"
				className={stepClass}
			>
				<ChevronLeft className="size-4" />
			</button>
			<button
				type="button"
				onClick={onNext}
				aria-label="Next"
				className={stepClass}
			>
				<ChevronRight className="size-4" />
			</button>
			<button
				type="button"
				onClick={onToday}
				className={cn(
					"rounded-md border border-line px-2.5 font-medium text-fg outline-none transition-colors hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring",
					touch ? "min-h-11 text-sm" : "h-7 text-xs",
				)}
			>
				Today
			</button>
			<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
				{title}
			</h2>
			{children}
		</div>
	);
}
