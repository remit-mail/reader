import { Avatar, cn } from "@remit/ui";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import type { SeamMessage } from "../../fixtures/calendar-seam.js";

/**
 * The thread, with the times it names marked in place. A detected time is not
 * moved to a panel and paraphrased — it is underlined where the sender wrote
 * it, so the reading can be checked against the sentence without scrolling.
 *
 * Read newest first, as the app reads a conversation: the turn a reader came
 * for is the last one, and it does not cost a scroll past everything that led
 * to it. Messages arrive oldest first, which is the thread's own fact.
 */

export interface ThreadTranscriptProps {
	messages: SeamMessage[];
	/** Marks to draw live; anything not listed renders as plain prose. */
	activeMarks?: ReadonlySet<string>;
	onMarkClick?: (mark: string) => void;
	/** Slotted under the message with this id — the invite card, the picker. */
	slotAfter?: (messageId: string) => ReactNode;
	className?: string;
}

export function ThreadTranscript({
	messages,
	activeMarks,
	onMarkClick,
	slotAfter,
	className,
}: ThreadTranscriptProps) {
	return (
		<div className={cn("flex flex-col", className)}>
			{[...messages].reverse().map((message) => (
				<article
					key={message.id}
					className="border-b border-line px-row-inset py-3 last:border-b-0"
				>
					<header className="flex items-center gap-2.5">
						<Avatar
							name={message.fromName}
							email={message.fromEmail}
							size="md"
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm font-medium text-fg">
								{message.fromName}
							</span>
							<span className="block truncate text-2xs text-fg-subtle">
								to {message.toLabel}
							</span>
						</span>
						<span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
							{message.dateLabel}
						</span>
					</header>

					{message.afterTheFact && (
						<p className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-2xs text-warning">
							<Clock className="size-3 shrink-0" aria-hidden />
							Arrived after this went on your calendar.
						</p>
					)}

					<div className="mt-2 flex flex-col gap-2">
						{message.paragraphs.map((paragraph) => (
							<p
								key={paragraph.map((segment) => segment.text).join("")}
								className="text-sm leading-relaxed text-fg"
							>
								{paragraph.map((segment) =>
									segment.mark === undefined ? (
										<span key={segment.text}>{segment.text}</span>
									) : (
										<button
											key={segment.text}
											type="button"
											onClick={() => onMarkClick?.(segment.mark ?? "")}
											className={cn(
												"rounded-xs underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring",
												activeMarks?.has(segment.mark)
													? "bg-accent-2-soft font-medium text-fg decoration-accent-2"
													: "decoration-line-strong hover:bg-surface-sunken",
											)}
										>
											{segment.text}
										</button>
									),
								)}
							</p>
						))}
					</div>

					{slotAfter?.(message.id)}
				</article>
			))}
		</div>
	);
}
