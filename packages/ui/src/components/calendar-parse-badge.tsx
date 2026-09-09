import { Code2, FileText, TextSearch } from "lucide-react";
import { cn } from "../lib/cn.js";
import type { CalendarParseMethod } from "./calendar-types.js";

/**
 * Which rung of the ladder answered. Saying so is not trivia: it is the
 * difference between a fact the sender stated and a guess the reader made, and
 * the reader is the one who has to decide how hard to check.
 */

export const calendarParseLabel: Record<CalendarParseMethod, string> = {
	ics: "Attached invitation",
	markup: "Structured markup",
	pattern: "Read from the words",
};

export const calendarParseNote: Record<CalendarParseMethod, string> = {
	ics: "A text/calendar part came with the mail. These are the sender's own fields, copied.",
	markup:
		"The mail carried a machine-readable booking block. The fields below are copied out of it.",
	pattern:
		"Nothing machine-readable came with this. The fields below are a reading of the prose, and a reading can be wrong.",
};

const icons: Record<CalendarParseMethod, typeof FileText> = {
	ics: FileText,
	markup: Code2,
	pattern: TextSearch,
};

const tones: Record<CalendarParseMethod, string> = {
	ics: "border-positive/50 text-positive",
	markup: "border-accent-2/50 text-accent-2",
	pattern: "border-warning/50 text-warning",
};

export interface CalendarParseBadgeProps {
	method: CalendarParseMethod;
	className?: string;
}

export function CalendarParseBadge({
	method,
	className,
}: CalendarParseBadgeProps) {
	const Icon = icons[method];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium",
				tones[method],
				className,
			)}
		>
			<Icon className="size-3" aria-hidden />
			{calendarParseLabel[method]}
		</span>
	);
}
