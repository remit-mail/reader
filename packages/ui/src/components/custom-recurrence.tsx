/**
 * The rule the offered choices do not cover.
 *
 * Every second Tuesday, Mondays and Thursdays until October, thirteen times and
 * then stop — a picker of derived choices cannot express any of those, and the
 * alternative is asking someone to type an RRULE. So the parts of a rule are
 * controls: how often, which days, and when it stops. What comes out is still a
 * sentence.
 */

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId } from "react";
import { cn } from "../lib/cn.js";
import {
	type CustomRecurrence,
	dayOfMonthLabel,
	ordinalWeekdayLabel,
	type RecurrenceEnd,
	type RecurrenceUnit,
	WEEKDAY_INITIALS,
	weekdayName,
} from "../lib/recurrence.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

const UNITS: RecurrenceUnit[] = ["day", "week", "month", "year"];
const MAX_INTERVAL = 99;
const MAX_COUNT = 999;

/** What the counted ending shows before anyone counts: a field, not a gap. */
const SUGGESTED_COUNT = 13;

export interface CustomRecurrenceEditorProps {
	value: CustomRecurrence;
	onChange: (next: CustomRecurrence) => void;
	/** The event's own day — what the monthly readings are derived from. */
	date: string;
	/** The date the "on" ending offers before anyone picks one. */
	suggestedEndDate: string;
	touch?: boolean;
	className?: string;
}

/** The heading names the group it sits over, so the group points back at it. */
function Section({
	label,
	children,
}: {
	label: string;
	children: (labelId: string) => React.ReactNode;
}) {
	const labelId = useId();
	return (
		<div className="flex flex-col gap-2">
			<span
				id={labelId}
				className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle"
			>
				{label}
			</span>
			{children(labelId)}
		</div>
	);
}

function Stepper({
	value,
	min,
	max,
	onChange,
	label,
	touch,
}: {
	value: number;
	min: number;
	max: number;
	onChange: (next: number) => void;
	label: string;
	touch?: boolean;
}) {
	const clamp = (next: number) => Math.min(Math.max(next, min), max);
	return (
		<div className="flex items-stretch gap-1">
			<Input
				type="number"
				inputMode="numeric"
				min={min}
				max={max}
				value={String(value)}
				aria-label={label}
				onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
				className={cn("own-steppers w-20 tabular-nums", touch && "min-h-11")}
			/>
			<div className="flex flex-col justify-between">
				<button
					type="button"
					aria-label={`${label} up`}
					onClick={() => onChange(clamp(value + 1))}
					className="flex h-4 w-6 items-center justify-center rounded-xs text-fg-subtle outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ChevronUp className="size-3.5" />
				</button>
				<button
					type="button"
					aria-label={`${label} down`}
					onClick={() => onChange(clamp(value - 1))}
					className="flex h-4 w-6 items-center justify-center rounded-xs text-fg-subtle outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ChevronDown className="size-3.5" />
				</button>
			</div>
		</div>
	);
}

export function CustomRecurrenceEditor({
	value,
	onChange,
	date,
	suggestedEndDate,
	touch,
	className,
}: CustomRecurrenceEditorProps) {
	const endsName = useId();
	const monthlyName = useId();
	const set = (patch: Partial<CustomRecurrence>) =>
		onChange({ ...value, ...patch });
	const setEnds = (ends: RecurrenceEnd) => set({ ends });

	const endDate =
		value.ends.kind === "onDate" ? value.ends.date : suggestedEndDate;
	const endCount =
		value.ends.kind === "afterCount" ? value.ends.count : SUGGESTED_COUNT;

	return (
		<div className={cn("flex flex-col gap-5", className)}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-fg">Repeat every</span>
				<Stepper
					value={value.interval}
					min={1}
					max={MAX_INTERVAL}
					onChange={(interval) => set({ interval })}
					label="Repeat every"
					touch={touch}
				/>
				<Select
					aria-label="Unit"
					value={value.unit}
					onChange={(e) => set({ unit: e.target.value as RecurrenceUnit })}
					className={cn("w-32", touch && "min-h-11")}
				>
					{UNITS.map((unit) => (
						<option key={unit} value={unit}>
							{value.interval > 1 ? `${unit}s` : unit}
						</option>
					))}
				</Select>
			</div>

			{value.unit === "week" && (
				<Section label="Repeat on">
					{(labelId) => (
						<fieldset
							aria-labelledby={labelId}
							className="flex min-w-0 gap-1.5"
						>
							{WEEKDAY_INITIALS.map((initial, index) => {
								const on = value.weekdays.includes(index);
								return (
									<label
										key={weekdayName(index)}
										className={cn(
											"inline-flex flex-1 cursor-pointer items-center justify-center rounded-full text-xs font-medium transition-colors",
											"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
											touch ? "h-11 max-w-11" : "h-9 max-w-9",
											on
												? "bg-accent text-accent-fg"
												: "bg-surface-sunken text-fg-muted hover:bg-surface-raised hover:text-fg",
										)}
									>
										<input
											type="checkbox"
											checked={on}
											aria-label={weekdayName(index)}
											onChange={() =>
												set({
													weekdays: on
														? value.weekdays.filter((day) => day !== index)
														: [...value.weekdays, index],
												})
											}
											className="sr-only"
										/>
										{initial}
									</label>
								);
							})}
						</fieldset>
					)}
				</Section>
			)}

			{value.unit === "month" && (
				<Section label="Repeat on">
					{(labelId) => (
						<div
							role="radiogroup"
							aria-labelledby={labelId}
							className="flex flex-col gap-1.5"
						>
							{(
								[
									["dayOfMonth", dayOfMonthLabel(date)],
									["weekdayOfMonth", ordinalWeekdayLabel(date)],
								] as const
							).map(([mode, label]) => (
								<label
									key={mode}
									htmlFor={`${monthlyName}-${mode}`}
									className={cn(
										"flex cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-fg",
										"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
										touch ? "min-h-11" : "min-h-9",
									)}
								>
									<Radio
										id={`${monthlyName}-${mode}`}
										name={monthlyName}
										checked={value.monthlyMode === mode}
										onChange={() => set({ monthlyMode: mode })}
									/>
									on {label}
								</label>
							))}
						</div>
					)}
				</Section>
			)}

			<Section label="Ends">
				{(labelId) => (
					<div
						role="radiogroup"
						aria-labelledby={labelId}
						className="flex flex-col gap-1.5"
					>
						<label
							htmlFor={`${endsName}-never`}
							className={cn(
								"flex cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-fg",
								"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
								touch ? "min-h-11" : "min-h-9",
							)}
						>
							<Radio
								id={`${endsName}-never`}
								name={endsName}
								checked={value.ends.kind === "never"}
								onChange={() => setEnds({ kind: "never" })}
							/>
							Never
						</label>

						<div
							className={cn(
								"flex items-center gap-2.5 px-1",
								touch ? "min-h-11" : "min-h-9",
							)}
						>
							<label
								htmlFor={`${endsName}-on`}
								className="flex cursor-pointer items-center gap-2.5 text-sm text-fg"
							>
								<Radio
									id={`${endsName}-on`}
									name={endsName}
									checked={value.ends.kind === "onDate"}
									onChange={() => setEnds({ kind: "onDate", date: endDate })}
								/>
								On
							</label>
							<Input
								type="date"
								value={endDate}
								aria-label="Ends on"
								onChange={(e) =>
									setEnds({ kind: "onDate", date: e.target.value })
								}
								onFocus={() => setEnds({ kind: "onDate", date: endDate })}
								className={cn(
									"w-40",
									touch && "min-h-11",
									value.ends.kind !== "onDate" && "opacity-55",
								)}
							/>
						</div>

						<div
							className={cn(
								"flex flex-wrap items-center gap-2.5 px-1",
								touch ? "min-h-11" : "min-h-9",
							)}
						>
							<label
								htmlFor={`${endsName}-after`}
								className="flex cursor-pointer items-center gap-2.5 text-sm text-fg"
							>
								<Radio
									id={`${endsName}-after`}
									name={endsName}
									checked={value.ends.kind === "afterCount"}
									onChange={() =>
										setEnds({ kind: "afterCount", count: endCount })
									}
								/>
								After
							</label>
							<div
								className={cn(value.ends.kind !== "afterCount" && "opacity-55")}
							>
								<Stepper
									value={endCount}
									min={1}
									max={MAX_COUNT}
									onChange={(count) => setEnds({ kind: "afterCount", count })}
									label="Occurrences"
									touch={touch}
								/>
							</div>
							<span className="text-sm text-fg-muted">occurrences</span>
						</div>
					</div>
				)}
			</Section>
		</div>
	);
}

export interface CustomRecurrenceDialogProps
	extends CustomRecurrenceEditorProps {
	open: boolean;
	onCancel: () => void;
	onDone: () => void;
}

/**
 * On a screen with a pane there is one editing surface and nothing floats over
 * it — except this. A custom rule is a decision nested inside the form rather
 * than a second form, so it is a small card over the pane that stays readable
 * behind it, and it leaves as soon as it is answered.
 */
export function CustomRecurrenceDialog({
	open,
	onCancel,
	onDone,
	...editor
}: CustomRecurrenceDialogProps) {
	return (
		<Dialog
			open={open}
			onClose={onCancel}
			title="Custom recurrence"
			className="max-w-sm"
		>
			<div className="flex flex-col gap-5 p-5">
				<h3 className="text-lg font-semibold text-fg">Custom recurrence</h3>
				<CustomRecurrenceEditor {...editor} />
				<div className="flex items-center justify-end gap-2">
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="primary" onClick={onDone}>
						Done
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

function Radio({
	id,
	name,
	checked,
	onChange,
}: {
	id: string;
	name: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<span className="relative inline-flex">
			<input
				id={id}
				type="radio"
				name={name}
				checked={checked}
				onChange={onChange}
				className={cn(
					"peer size-5 shrink-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-surface outline-none transition-colors",
					"checked:border-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
				)}
			/>
			<span className="pointer-events-none absolute inset-0 m-auto hidden size-2.5 rounded-full bg-accent peer-checked:block" />
		</span>
	);
}
