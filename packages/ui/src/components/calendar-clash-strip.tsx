import { Check, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.js";
import type { CalendarClash } from "./calendar-types.js";

/**
 * What a span would cost, stated before the answer rather than after it. Every
 * mail client offers Accept; none of them can say what saying yes runs into,
 * because none of them owns the calendar the answer lands in. The clear case is
 * drawn too — silence there would read as "not checked".
 */

export interface CalendarClashStripProps {
	clashes: CalendarClash[];
	/** What the clear case says. The caller knows which span was checked. */
	clearText?: string;
	className?: string;
}

export function CalendarClashStrip({
	clashes,
	clearText = "Nothing else is booked over it.",
	className,
}: CalendarClashStripProps) {
	if (clashes.length === 0)
		return (
			<p
				className={cn(
					"flex items-center gap-2 rounded-md border border-line bg-surface-sunken p-2 text-xs text-fg-muted",
					className,
				)}
			>
				<Check className="size-3.5 shrink-0 text-positive" aria-hidden />
				{clearText}
			</p>
		);

	return (
		<div
			className={cn(
				"flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-2",
				className,
			)}
		>
			<TriangleAlert
				className="mt-0.5 size-4 shrink-0 text-danger"
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold text-danger">
					{clashes.length === 1
						? "This clashes with something you have already agreed to."
						: `This clashes with ${clashes.length} things you have already agreed to.`}
				</p>
				<ul className="mt-1 flex flex-col gap-0.5">
					{clashes.map((clash) => (
						<li key={clash.id} className="text-xs text-fg">
							{clash.label}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
