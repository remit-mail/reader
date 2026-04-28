import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Paperclip } from "lucide-react";
import { type MouseEvent, memo, useCallback } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useLongPress } from "@/hooks/useLongPress";
import { formatEmailDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MailboxLinkSearch {
	selectedMessageId?: string;
	q?: string;
}

interface MessageListItemProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	isSelected: boolean;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	messageCount?: number;
	/** When true, the checkbox is always visible (e.g. mobile multi-select mode). */
	isMultiSelectMode?: boolean;
	/** Called on long press (mobile only). */
	onLongPress?: () => void;
	/** Whether the current viewport is desktop size. */
	isDesktop?: boolean;
}

const truncateSnippet = (snippet: string, maxLength = 60): string => {
	if (snippet.length <= maxLength) return snippet;
	return `${snippet.slice(0, maxLength).trimEnd()}...`;
};

const MessageListItemComponent = ({
	thread,
	mailboxId,
	isSelected,
	isChecked,
	onToggleCheck,
	messageCount,
	isMultiSelectMode = false,
	onLongPress,
	isDesktop = true,
}: MessageListItemProps) => {
	const queryClient = useQueryClient();
	const participants = thread.fromName || thread.fromEmail || "Unknown";
	const date = formatEmailDate(thread.sentDate);
	const subject = thread.subject || "(No subject)";
	const displaySubject =
		messageCount && messageCount > 1 ? `${subject} (${messageCount})` : subject;
	const snippet = thread.snippet ? truncateSnippet(thread.snippet) : "";

	const handleCheckboxClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onToggleCheck(thread.messageId);
	};

	// Wire up long press for mobile
	const longPressHandlers = useLongPress({
		onLongPress: () => onLongPress?.(),
		delayMs: 500,
	});

	// Intent-based prefetch: by the time the user clicks, the body is in
	// React Query's cache and the detail pane renders without a spinner.
	// Fires only on hover/focus (not on every paint), and React Query
	// dedupes concurrent requests for the same key automatically.
	const prefetchMessage = useCallback(() => {
		queryClient.prefetchQuery(
			messageOperationsDescribeMessageOptions({
				path: { messageId: thread.messageId },
			}),
		);
	}, [queryClient, thread.messageId]);

	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId }}
			search={(prev: MailboxLinkSearch) => ({
				...prev,
				selectedMessageId: thread.messageId,
			})}
			data-message-row
			onMouseEnter={prefetchMessage}
			onFocus={prefetchMessage}
			{...(!isDesktop && longPressHandlers.handlers)}
			className={cn(
				// Bump vertical padding on mobile to comfortably exceed the 48dp
				// touch-target floor. Desktop keeps the tighter density.
				"group block px-3 py-3 sm:py-2.5 border-b border-border transition-colors",
				"hover:bg-accent/50",
				isSelected && "bg-accent",
				isChecked && "bg-primary/10",
			)}
		>
			<div className="flex items-start gap-3">
				{/* Leading column: avatar by default, checkbox on hover (desktop)
				    or while selected. The slot is a fixed 40px so the rest of the
				    row never reflows when state changes. */}
				<div className="relative size-10 shrink-0">
					<Avatar
						name={thread.fromName ?? undefined}
						email={thread.fromEmail ?? undefined}
						size={40}
						className={cn(
							"absolute inset-0",
							"sm:group-hover:opacity-0 transition-opacity",
							(isChecked || isMultiSelectMode) && "opacity-0",
						)}
					/>
					<button
						type="button"
						onClick={handleCheckboxClick}
						className={cn(
							"absolute inset-0 size-10 rounded-full border items-center justify-center transition-opacity min-h-11 min-w-11",
							isMultiSelectMode ? "flex" : "hidden sm:flex",
							isChecked
								? "bg-primary border-primary text-primary-foreground opacity-100"
								: isMultiSelectMode
									? "border-muted-foreground/40 opacity-100 bg-background"
									: "border-muted-foreground/40 opacity-0 group-hover:opacity-100 bg-background",
						)}
						aria-label={isChecked ? "Deselect message" : "Select message"}
					>
						{isChecked && <Check className="size-4" />}
					</button>
				</div>

				<div className="flex-1 min-w-0">
					{/* Row 1: Unread dot + Participants + Date */}
					<div className="flex items-center gap-2 mb-1">
						<span
							className={cn(
								"w-2 h-2 rounded-full shrink-0 transition-opacity",
								!thread.isRead ? "bg-blue-500" : "bg-transparent",
								isChecked && "opacity-0",
							)}
						/>
						<span className="text-sm truncate flex-1 text-foreground">
							{participants}
						</span>
						<span
							data-testid="thread-time"
							className="text-xs text-muted-foreground shrink-0"
						>
							{date}
						</span>
					</div>

					{/* Row 2: Subject + Attachment icon */}
					<div className="flex items-center gap-2 pl-4 mb-1">
						<span
							className={cn(
								"text-sm truncate flex-1",
								!thread.isRead ? "text-foreground" : "text-muted-foreground",
							)}
						>
							{displaySubject}
						</span>
						{thread.hasAttachment && (
							<Paperclip
								className="size-3.5 shrink-0 text-muted-foreground"
								aria-label="Has attachments"
							/>
						)}
					</div>

					{/* Row 3: Snippet preview */}
					{snippet && (
						<div className="text-xs text-muted-foreground pl-4 line-clamp-1">
							{snippet}
						</div>
					)}
				</div>
			</div>
		</Link>
	);
};

// Wrapped in React.memo so virtualized rows don't re-render on every parent
// state change. The `search` callback prop on Link is inline, but it gets a
// stable reference because the parent itself is stable across re-renders
// (mailboxId is a string from route params). React.memo with default shallow
// equality is appropriate here since props are primitives + stable callback.
export const MessageListItem = memo(MessageListItemComponent);
