import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Avatar,
	ComfortableRowTextContent,
	CompactRowBody,
	comfortableRowClass,
	compactRowClass,
	type Density,
	type SenderTrustLevel,
	type ThreadRowData,
} from "@remit/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { type MouseEvent, memo, useCallback } from "react";
import { useLongPress } from "@/hooks/useLongPress";
import type { SelectionModifiers } from "@/hooks/useSelection";
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
	/**
	 * Roving keyboard focus cursor (#429). Distinct from `isSelected` (the open
	 * thread): a focused-but-not-open row shows the left accent rail; the open
	 * row shows the full highlight. Both can be true (the open row stays focused).
	 */
	isFocused?: boolean;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	/**
	 * Desktop mouse selection. Called from the row's onClick with the click
	 * modifiers. Returns true when selection consumed the click (the row should
	 * not navigate); false for a plain click (navigation proceeds).
	 */
	onRowSelect: (messageId: string, modifiers: SelectionModifiers) => boolean;
	messageCount?: number;
	/** When true, the checkbox is always visible (e.g. mobile multi-select mode). */
	isMultiSelectMode?: boolean;
	/** Called on long press (mobile only). Receives the row's messageId. */
	onLongPress?: (messageId: string) => void;
	/** Whether the current viewport is desktop size. */
	isDesktop?: boolean;
	/** Row density — comfortable (default) or compact (mutt mode). */
	density?: Density;
}

/**
 * Map a RemitImapThreadMessageResponse to the ThreadRowData shape used by
 * remit-ui row body components.
 */
const toThreadRowData = (
	thread: RemitImapThreadMessageResponse,
	messageCount: number | undefined,
): ThreadRowData => {
	// Use the backend's authoritative DKIM-alignment verdict rather than
	// re-deriving it in the view: dkimMismatch already accounts for the
	// multi-signature / alignment semantics a single string compare misses.
	const suspicious = thread.authenticity?.dkimMismatch === true;

	return {
		id: thread.messageId,
		accountId: thread.accountConfigId,
		fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
		fromEmail: thread.fromEmail ?? "",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		timeLabel: formatEmailDate(thread.sentDate),
		isRead: thread.isRead,
		hasAttachment: thread.hasAttachment,
		starred:
			thread.star != null && thread.star !== "none" && thread.hasStars === true,
		trust: thread.senderTrust as SenderTrustLevel,
		category: thread.category,
		messageCount,
		suspicious,
	};
};

const MessageListItemComponent = ({
	thread,
	mailboxId,
	isSelected,
	isFocused = false,
	isChecked,
	onToggleCheck,
	onRowSelect,
	messageCount,
	isMultiSelectMode = false,
	onLongPress,
	isDesktop = true,
	density = "comfortable",
}: MessageListItemProps) => {
	const queryClient = useQueryClient();
	const messageId = thread.messageId;
	const rowData = toThreadRowData(thread, messageCount);

	const handleCheckboxClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onToggleCheck(thread.messageId);
	};

	// Desktop mouse selection semantics. Plain click falls through to the Link's
	// navigation; shift / cmd / ctrl click is routed to selection and the
	// navigation is suppressed. On mobile this is a no-op so taps still open.
	const handleRowClick = useCallback(
		(e: MouseEvent) => {
			if (!isDesktop) return;
			const handled = onRowSelect(messageId, {
				shiftKey: e.shiftKey,
				metaKey: e.metaKey,
				ctrlKey: e.ctrlKey,
			});
			if (handled) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		[isDesktop, onRowSelect, messageId],
	);

	const handleLongPress = useCallback(() => {
		onLongPress?.(messageId);
	}, [onLongPress, messageId]);

	const longPressHandlers = useLongPress({
		onLongPress: handleLongPress,
		delayMs: 500,
	});

	// Intent-based prefetch: by the time the user clicks, the body is in
	// React Query's cache and the detail pane renders without a spinner.
	const prefetchMessage = useCallback(() => {
		queryClient.prefetchQuery(
			messageOperationsDescribeMessageOptions({
				path: { messageId: thread.messageId },
			}),
		);
	}, [queryClient, thread.messageId]);

	const unread = !thread.isRead;

	if (density === "compact") {
		return (
			<Link
				to="/mail/$mailboxId"
				params={{ mailboxId }}
				search={(prev: MailboxLinkSearch) => ({
					...prev,
					selectedMessageId: thread.messageId,
				})}
				data-message-row
				onClick={handleRowClick}
				onMouseEnter={prefetchMessage}
				onFocus={prefetchMessage}
				{...(!isDesktop && longPressHandlers.handlers)}
				className={cn(
					compactRowClass({ active: isSelected, focused: isFocused }),
					isChecked && "bg-accent-soft",
					!isDesktop && "min-h-11",
				)}
			>
				<CompactRowBody thread={rowData} />
			</Link>
		);
	}

	// Comfortable density: avatar/checkbox leading slot + text content.
	// The slot is a fixed 36px so the row never reflows when state changes.
	// Unread dot is positioned absolute (left-1.5, vertically centered).
	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId }}
			search={(prev: MailboxLinkSearch) => ({
				...prev,
				selectedMessageId: thread.messageId,
			})}
			data-message-row
			onClick={handleRowClick}
			onMouseEnter={prefetchMessage}
			onFocus={prefetchMessage}
			{...(!isDesktop && longPressHandlers.handlers)}
			className={cn(
				"group",
				comfortableRowClass({ active: isSelected, focused: isFocused }),
				isChecked && "bg-accent-soft",
				!isDesktop && "min-h-11",
			)}
		>
			{/* Absolute unread dot — 6px gutter from the left pane hairline */}
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}

			{/* Leading slot: avatar by default, checkbox on hover (desktop) or
			    while checked / in multi-select mode. Fixed 28px slot (size-7,
			    matching Avatar size="sm" in remit-ui ComfortableRow). */}
			<div className="relative size-7 shrink-0">
				<Avatar
					name={thread.fromName ?? thread.fromEmail ?? "?"}
					email={thread.fromEmail ?? undefined}
					size="sm"
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
						"absolute inset-0 size-7 rounded-full border items-center justify-center transition-opacity",
						isMultiSelectMode ? "flex" : "hidden sm:flex",
						isChecked
							? "bg-accent border-accent text-accent-fg opacity-100"
							: isMultiSelectMode
								? "border-fg-subtle/40 opacity-100 bg-canvas"
								: "border-fg-subtle/40 opacity-0 group-hover:opacity-100 bg-canvas",
					)}
					aria-label={isChecked ? "Deselect message" : "Select message"}
				>
					{isChecked && <Check className="size-3" />}
				</button>
			</div>

			{/* Text/glyph content block */}
			<ComfortableRowTextContent thread={rowData} />
		</Link>
	);
};

// Wrapped in React.memo so virtualized rows don't re-render on every parent
// state change. The `search` callback prop on Link is inline, but it gets a
// stable reference because the parent itself is stable across re-renders
// (mailboxId is a string from route params). React.memo with default shallow
// equality is appropriate here since props are primitives + stable callback.
export const MessageListItem = memo(MessageListItemComponent);
