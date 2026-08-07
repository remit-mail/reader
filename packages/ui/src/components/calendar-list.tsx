import { Check } from "lucide-react";
import { calendarColorClasses } from "../lib/calendar-color.js";
import { cn } from "../lib/cn.js";
import type { CalendarDescriptor } from "./calendar-types.js";

export interface CalendarListProps {
	calendars: CalendarDescriptor[];
	/** Ids currently drawn on the grid. Anything absent is off. */
	visible: ReadonlySet<string>;
	onToggle: (calendarId: string) => void;
	/** Ticks or clears a whole account in one go. */
	onToggleAccount?: (accountId: string, nextVisible: boolean) => void;
	/**
	 * `list` is the column: grouped by account, one row each. `strip` is the same
	 * control laid out as a scrolling row of chips, for a surface with no room
	 * for a rail. The control stays on screen either way — it never becomes a
	 * popover.
	 */
	layout?: "list" | "strip";
	/** Grows every row to a thumb target. */
	touch?: boolean;
	className?: string;
}

interface AccountGroup {
	accountId: string;
	accountLabel: string;
	calendars: CalendarDescriptor[];
}

function groupByAccount(calendars: CalendarDescriptor[]): AccountGroup[] {
	const order: string[] = [];
	const byAccount = new Map<string, AccountGroup>();
	for (const calendar of calendars) {
		let group = byAccount.get(calendar.accountId);
		if (!group) {
			group = {
				accountId: calendar.accountId,
				accountLabel: calendar.accountLabel,
				calendars: [],
			};
			byAccount.set(calendar.accountId, group);
			order.push(calendar.accountId);
		}
		group.calendars.push(calendar);
	}
	return order.map((id) => byAccount.get(id) as AccountGroup);
}

/**
 * The legend and the filter in one control, and always on screen. A calendar's
 * colour means nothing unless the thing that names the colour is visible at the
 * same time as the grid, so this never collapses into a popover or a settings
 * page — turning a calendar off is a first-class move, not a preference.
 */
export function CalendarList({
	calendars,
	visible,
	onToggle,
	onToggleAccount,
	layout = "list",
	touch,
	className,
}: CalendarListProps) {
	if (layout === "strip") {
		return (
			<div
				className={cn(
					"flex items-center gap-1.5 overflow-x-auto px-row-inset",
					className,
				)}
			>
				{calendars.map((calendar) => {
					const hue = calendarColorClasses(calendar.color);
					const checked = visible.has(calendar.id);
					return (
						<label
							key={calendar.id}
							className={cn(
								"inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
								"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
								touch ? "min-h-9" : "h-7",
								checked
									? cn(hue.soft, hue.text, hue.border)
									: "border-line text-fg-subtle",
							)}
						>
							<input
								type="checkbox"
								checked={checked}
								onChange={() => onToggle(calendar.id)}
								className="sr-only"
							/>
							<span
								className={cn(
									"size-2 rounded-full border",
									hue.border,
									checked ? hue.solid : "bg-transparent",
								)}
							/>
							{calendar.name}
						</label>
					);
				})}
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{groupByAccount(calendars).map((group) => {
				const allOn = group.calendars.every((c) => visible.has(c.id));
				return (
					<section key={group.accountId} className="flex flex-col">
						<div className="flex items-center gap-2 px-row-inset pb-1">
							<h3 className="flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
								{group.accountLabel}
							</h3>
							{onToggleAccount && (
								<button
									type="button"
									onClick={() => onToggleAccount(group.accountId, !allOn)}
									className="rounded-sm text-2xs text-fg-subtle outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
								>
									{allOn ? "None" : "All"}
								</button>
							)}
						</div>
						{group.calendars.map((calendar) => (
							<CalendarListRow
								key={calendar.id}
								calendar={calendar}
								checked={visible.has(calendar.id)}
								touch={touch}
								onToggle={() => onToggle(calendar.id)}
							/>
						))}
					</section>
				);
			})}
		</div>
	);
}

function CalendarListRow({
	calendar,
	checked,
	touch,
	onToggle,
}: {
	calendar: CalendarDescriptor;
	checked: boolean;
	touch?: boolean;
	onToggle: () => void;
}) {
	const hue = calendarColorClasses(calendar.color);
	return (
		<label
			className={cn(
				"flex cursor-pointer items-center gap-2.5 rounded-sm px-row-inset hover:bg-surface-sunken",
				touch ? "min-h-11" : "min-h-9",
			)}
		>
			<input
				type="checkbox"
				checked={checked}
				onChange={onToggle}
				className="peer sr-only"
			/>
			<span
				aria-hidden
				className={cn(
					"flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
					"peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-surface",
					checked
						? cn(hue.solid, hue.border)
						: cn("bg-transparent", hue.border),
				)}
			>
				{checked && <Check className="size-3 text-canvas" strokeWidth={3} />}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					checked ? "text-fg" : "text-fg-subtle",
				)}
			>
				{calendar.name}
			</span>
		</label>
	);
}
