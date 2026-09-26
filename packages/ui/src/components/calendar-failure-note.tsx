import { TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface CalendarFailureNoteProps {
	/** What did not happen, and what to do about it. */
	text: string;
	/** A prefilled issue to file when retrying does not help. */
	reportHref?: string;
	className?: string;
}

/**
 * An answer or a read that did not land, stated where it was asked for, with
 * the way to report it when trying again does not help.
 */
export function CalendarFailureNote({
	text,
	reportHref,
	className,
}: CalendarFailureNoteProps) {
	return (
		<div
			role="alert"
			className={cn(
				"flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-2 text-xs text-danger",
				className,
			)}
		>
			<TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1">
				{text}
				{reportHref && (
					<>
						{" "}
						<a
							href={reportHref}
							target="_blank"
							rel="noreferrer"
							className="font-medium text-accent hover:underline"
						>
							Report an issue
						</a>
					</>
				)}
			</p>
		</div>
	);
}
