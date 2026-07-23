/**
 * MessageRow — the one thread row every list in the app renders.
 *
 * The mailbox list, the daily brief and Flagged used to carry three
 * near-identical rows (#149). They differ in two axes only, both props here:
 *
 * - `linkMailboxId` — set for the mailbox list, whose rows are real links so a
 *   plain click routes and a middle click opens a tab. Omitted for the brief
 *   and Flagged, whose rows report the tap through `onClick`.
 * - `selection` — set where multi-select is available. Absent renders the
 *   avatar alone with no checkbox, which is what "non-selectable mode" means.
 */
import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	ComfortableRowBody,
	CompactRowBody,
	comfortableRowClass,
	compactRowClass,
	type Density,
	mergeProps,
	type RowToggleEvent,
	type ThreadRowData,
	useLongPress,
} from "@remit/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type MouseEvent, memo, type ReactNode, useCallback } from "react";
import type { SelectionModifiers } from "@/hooks/useSelection";
import { cn } from "@/lib/utils";
import { useThreadRowInteraction } from "./ThreadListInteraction";

interface MailboxLinkSearch {
	selectedMessageId?: string;
	q?: string;
}

export interface MessageRowSelection {
	isChecked: boolean;
	onToggleCheck: (messageId: string) => void;
	/**
	 * Desktop mouse selection. Returns true when selection consumed the click
	 * (the row must not open); false for a plain click.
	 */
	onRowSelect: (messageId: string, modifiers: SelectionModifiers) => boolean;
	/** Checkbox stays visible — mobile multi-select mode. */
	isMultiSelectMode?: boolean;
	/** Long press enters selection mode (mobile only). */
	onLongPress?: (messageId: string) => void;
}

export interface MessageRowProps {
	thread: ThreadRowData;
	/** The row is the open thread. */
	active?: boolean;
	/**
	 * Roving keyboard focus cursor (#429). Distinct from `active`: a
	 * focused-but-not-open row shows the left accent rail; the open row shows the
	 * full highlight. Both can be true.
	 */
	focused?: boolean;
	/**
	 * Whether this row holds the list's single tab stop (roving tabindex). Every
	 * other row is `tabIndex={-1}`, so Tab enters the list at the cursor and
	 * Shift+Tab leaves it rather than stepping through hundreds of rows.
	 */
	isTabStop?: boolean;
	density?: Density;
	isDesktop?: boolean;
	/** Extra chip after the category badge (e.g. the auto-moved indicator). */
	badge?: ReactNode;
	selection?: MessageRowSelection;
	/**
	 * The row sits inside a container with `role="listbox"` (the mailbox list),
	 * so it carries `role="option"` and `aria-selected`. Off everywhere else:
	 * the brief and Flagged render their rows in ordinary containers, where an
	 * orphan `option` is invalid ARIA and costs the row its button semantics.
	 */
	inListbox?: boolean;
	/** Mailbox whose route the row links to; omit for callback-driven rows. */
	linkMailboxId?: string;
	/** Called when the row is opened by a plain click on a non-linking row. */
	onClick?: () => void;
	/** Called when the row takes DOM focus, so the roving cursor follows it. */
	onFocusRow?: (messageId: string) => void;
}

const MessageRowComponent = ({
	thread,
	active = false,
	focused: focusedProp,
	isTabStop: isTabStopProp,
	density = "comfortable",
	isDesktop: isDesktopProp,
	badge,
	selection: selectionProp,
	inListbox = false,
	linkMailboxId,
	onClick,
	onFocusRow: onFocusRowProp,
}: MessageRowProps) => {
	const queryClient = useQueryClient();
	const messageId = thread.id;
	// A list that renders its own rows (the brief, Flagged) supplies the cursor
	// and selection through context; the mailbox list passes them as props.
	const fromContext = useThreadRowInteraction(messageId);
	const focused = focusedProp ?? fromContext?.focused ?? false;
	const isTabStop = isTabStopProp ?? fromContext?.isTabStop ?? false;
	const selection = selectionProp ?? fromContext?.selection;
	const onFocusRow = onFocusRowProp ?? fromContext?.onFocusRow;
	// The cursor and the row must agree on the device: the cursor's multi-select
	// mode is derived from it, and the row's tap semantics branch on it.
	const isDesktop = isDesktopProp ?? fromContext?.isDesktop ?? true;
	const isChecked = selection?.isChecked ?? false;
	const isMultiSelectMode = selection?.isMultiSelectMode ?? false;
	const onToggleCheck = selection?.onToggleCheck;
	const onRowSelect = selection?.onRowSelect;
	const onLongPress = selection?.onLongPress;

	const handleToggleCheck = useCallback(
		(e: RowToggleEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onToggleCheck?.(messageId);
		},
		[onToggleCheck, messageId],
	);

	// Desktop mouse selection semantics. Plain click falls through to the Link's
	// navigation (or `onClick` on a non-linking row); shift / cmd / ctrl click is
	// routed to selection and the navigation is suppressed.
	//
	// A modified click must preventDefault: the router skips navigation for any
	// modified click and leaves the anchor's own default in place, which in a
	// browser means shift-click opens a new window and cmd-click a new tab.
	// Shift-click also drags a native text selection across the rows it spans,
	// so drop it — the row highlight is the selection the user asked for.
	//
	// On mobile, once selection mode is active (#92) a plain tap toggles the row
	// instead of opening it — the same tap-to-toggle contract every reference
	// mail client uses once you're mid-selection.
	const handleRowClick = useCallback(
		(e: MouseEvent) => {
			if (!isDesktop) {
				if (isMultiSelectMode) {
					e.preventDefault();
					e.stopPropagation();
					onToggleCheck?.(messageId);
					return;
				}
				onClick?.();
				return;
			}
			const modifiers = {
				shiftKey: e.shiftKey,
				metaKey: e.metaKey,
				ctrlKey: e.ctrlKey,
			};
			if (onRowSelect?.(messageId, modifiers)) {
				e.preventDefault();
				e.stopPropagation();
				if (modifiers.shiftKey) window.getSelection()?.removeAllRanges();
				return;
			}
			onClick?.();
		},
		[
			isDesktop,
			isMultiSelectMode,
			onToggleCheck,
			onRowSelect,
			onClick,
			messageId,
		],
	);

	// Shift-click starts a native text selection on mousedown; suppressing it
	// there keeps the drag from painting a text range over the rows.
	const handleRowMouseDown = useCallback(
		(e: MouseEvent) => {
			if (!isDesktop) return;
			if (e.shiftKey) e.preventDefault();
		},
		[isDesktop],
	);

	const handleLongPress = useCallback(() => {
		onLongPress?.(messageId);
	}, [onLongPress, messageId]);

	const { longPressProps } = useLongPress({
		onLongPress: handleLongPress,
		delayMs: 500,
		accessibilityDescription: isChecked ? "Deselect message" : "Select message",
	});

	// Intent-based prefetch: by the time the user clicks, the body is in
	// React Query's cache and the detail pane renders without a spinner.
	const prefetchMessage = useCallback(() => {
		queryClient.prefetchQuery(
			messageOperationsDescribeMessageOptions({ path: { messageId } }),
		);
	}, [queryClient, messageId]);

	const handleRowFocus = useCallback(() => {
		prefetchMessage();
		onFocusRow?.(messageId);
	}, [prefetchMessage, onFocusRow, messageId]);

	// Listbox semantics + roving tabindex, shared by both densities. Merged (not
	// spread) with the mobile long-press props: react-aria's pressProps carries
	// its own onClick for its internal press bookkeeping, and a plain object
	// spread would silently drop whichever onClick landed second instead of
	// running both.
	const interactionProps = mergeProps(
		{
			"data-list-row": "",
			"data-message-row": true,
			"data-message-id": messageId,
			...(inListbox
				? { role: "option" as const, "aria-selected": isChecked }
				: {}),
			tabIndex: isTabStop ? 0 : -1,
			onClick: handleRowClick,
			onMouseDown: handleRowMouseDown,
			onMouseEnter: prefetchMessage,
			onFocus: handleRowFocus,
		},
		isDesktop || !selection ? {} : longPressProps,
	);

	const className = cn(
		density === "compact"
			? compactRowClass({ active, focused })
			: cn("group", comfortableRowClass({ active, focused })),
		"outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
		isChecked && "bg-accent-soft",
		// Long-press enters selection mode; without these, Android Chrome opens
		// the link context menu / starts text selection and iOS Safari fires the
		// callout, racing the app's handler. react-aria suppresses
		// contextmenu/text-selection but not iOS's callout — it fires no
		// cancelable event, so CSS is the only lever.
		!isDesktop && "min-h-11 select-none [-webkit-touch-callout:none]",
	);

	const body =
		density === "compact" ? (
			<CompactRowBody thread={thread} />
		) : (
			<ComfortableRowBody
				thread={thread}
				badge={badge}
				selection={
					selection
						? {
								checked: isChecked,
								alwaysVisible: isMultiSelectMode,
								onToggle: handleToggleCheck,
							}
						: undefined
				}
			/>
		);

	if (linkMailboxId === undefined) {
		return (
			<button type="button" {...interactionProps} className={className}>
				{body}
			</button>
		);
	}

	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId: linkMailboxId }}
			search={(prev: MailboxLinkSearch) => ({
				...prev,
				selectedMessageId: messageId,
			})}
			{...interactionProps}
			className={className}
		>
			{body}
		</Link>
	);
};

// Wrapped in React.memo so virtualized rows don't re-render on every parent
// state change. Props are primitives plus callbacks the parents keep stable, so
// default shallow equality is appropriate.
export const MessageRow = memo(MessageRowComponent);
