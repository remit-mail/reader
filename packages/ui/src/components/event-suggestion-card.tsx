import { AlertTriangle, Mail, Plus, SlidersHorizontal, X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import type { EventSuggestion } from "./calendar-types.js";

export interface EventSuggestionCardProps {
	suggestion: EventSuggestion;
	/** Already formatted by the caller. */
	whenText: string;
	onAdd: () => void;
	onReview: () => void;
	onDismiss: () => void;
	onOpenThread: () => void;
	touch?: boolean;
	className?: string;
}

/** Words for a number, so the card never shows a false 87%. */
function confidenceText(confidence: number): string {
	if (confidence >= 0.85) return "Read cleanly";
	if (confidence >= 0.6) return "Read with gaps";
	return "Barely read";
}

/**
 * A candidate, and unmistakably not an event. It lives off the grid, on a
 * dashed card, and only a person pressing Add puts anything on the calendar —
 * a machine reading of a mail never becomes a provisional block that someone
 * has to notice and remove.
 */
export function EventSuggestionCard({
	suggestion,
	whenText,
	onAdd,
	onReview,
	onDismiss,
	onOpenThread,
	touch,
	className,
}: EventSuggestionCardProps) {
	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-sunken p-3",
				className,
			)}
		>
			<div className="flex items-start gap-2">
				<span className="min-w-0 flex-1">
					<span className="block text-2xs uppercase tracking-wider text-fg-subtle">
						Suggested from mail · {confidenceText(suggestion.confidence)}
					</span>
					<span className="block truncate text-sm font-medium text-fg">
						{suggestion.title}
					</span>
					<span className="block text-xs text-fg-muted">{whenText}</span>
					{suggestion.location !== "" && (
						<span className="block truncate text-xs text-fg-muted">
							{suggestion.location}
						</span>
					)}
				</span>
				<button
					type="button"
					aria-label="Dismiss suggestion"
					onClick={onDismiss}
					className={cn(
						"flex shrink-0 items-center justify-center rounded-md text-fg-subtle outline-none hover:bg-surface hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
						touch ? "size-11" : "size-7",
					)}
				>
					<X className="size-4" />
				</button>
			</div>

			{suggestion.ambiguity !== "" && (
				<p className="flex items-start gap-1.5 text-2xs text-warning">
					<AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
					{suggestion.ambiguity}
				</p>
			)}

			<button
				type="button"
				onClick={onOpenThread}
				className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-2xs text-accent-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Mail className="size-3 shrink-0" />
				<span className="truncate">
					{suggestion.sender} — {suggestion.threadSubject}
				</span>
			</button>

			<div className="flex items-center gap-2">
				<Button
					variant="primary"
					size={touch ? "md" : "sm"}
					icon={<Plus className="size-3.5" />}
					onClick={onAdd}
					className={touch ? "min-h-11 flex-1" : ""}
				>
					Add
				</Button>
				<Button
					variant="secondary"
					size={touch ? "md" : "sm"}
					icon={<SlidersHorizontal className="size-3.5" />}
					onClick={onReview}
					className={touch ? "min-h-11" : ""}
				>
					Change first
				</Button>
			</div>
		</div>
	);
}
