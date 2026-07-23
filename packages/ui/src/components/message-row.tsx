import { Paperclip, ShieldAlert, Star } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { LIST_ROW_ATTRIBUTE } from "../lib/roving-focus.js";
import { categoryTone, type ThreadRowData } from "./app-shell-types.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";

/** Visible keyboard-focus ring for a row reached by the list's arrow-key cursor. */
const ROW_FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * Returns the CSS classes for a compact row outer element.
 * `active` = open/selected; `focused` = keyboard-focused (left accent rail).
 */
export const compactRowClass = ({
	active,
	focused,
}: {
	active?: boolean;
	focused?: boolean;
}) =>
	cn(
		"relative flex h-8 w-full items-center gap-2 px-row-inset text-left",
		ROW_FOCUS_RING,
		active
			? "bg-accent-2-soft"
			: focused
				? "bg-surface-sunken"
				: "hover:bg-surface-sunken",
		focused &&
			!active &&
			"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-2",
	);

/**
 * Returns the CSS classes for a comfortable row outer element.
 * `active` = open/selected; `focused` = keyboard-focused (left accent rail).
 */
export const comfortableRowClass = ({
	active,
	focused,
}: {
	active?: boolean;
	focused?: boolean;
}) =>
	cn(
		// full-bleed highlight; content inset with a clear unread-dot gutter
		"relative flex w-full items-start gap-3 py-2 pl-5 pr-row-inset text-left transition-colors",
		ROW_FOCUS_RING,
		active
			? "bg-accent-2-soft"
			: focused
				? "bg-surface-sunken"
				: "hover:bg-surface-sunken",
		focused &&
			!active &&
			"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-2",
	);

/**
 * Inner body of a compact (mutt-mode) row. Place inside any wrapper element.
 * The wrapper should use `compactRowClass()` for the outer CSS.
 */
export function CompactRowBody({ thread }: { thread: ThreadRowData }) {
	const unread = !thread.isRead;
	return (
		<>
			<span className="flex w-4 shrink-0 items-center justify-center">
				{thread.suspicious ? (
					<ShieldAlert className="size-3.5 text-danger" />
				) : thread.starred ? (
					<Star className="size-3 fill-warning text-warning" />
				) : unread ? (
					<span className="size-1.5 rounded-full bg-accent" />
				) : null}
			</span>
			<span
				className={cn(
					"w-36 shrink-0 truncate text-xs",
					unread ? "font-semibold text-fg" : "text-fg-muted",
				)}
			>
				{thread.fromName}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs">
				<span className={cn(unread ? "font-medium text-fg" : "text-fg-muted")}>
					{thread.subject}
				</span>
				<span className="text-fg-subtle"> — {thread.snippet}</span>
			</span>
			{thread.hasAttachment && (
				<Paperclip className="size-3 shrink-0 text-fg-subtle" />
			)}
			<span className="w-11 shrink-0 text-right text-2xs text-fg-subtle tabular-nums">
				{thread.timeLabel}
			</span>
		</>
	);
}

/**
 * Text/glyph content block of a comfortable row (everything after the leading
 * avatar/slot). Consumers provide their own leading element (Avatar, checkbox,
 * etc.) and the unread dot (via the absolute-positioned sibling). Use this with
 * `comfortableRowClass()` and render the leading slot + unread dot separately.
 */
export function ComfortableRowTextContent({
	thread,
	badge,
}: {
	thread: ThreadRowData;
	/** Extra chip rendered after the category badge (e.g. an auto-moved indicator). */
	badge?: ReactNode;
}) {
	const unread = !thread.isRead;
	return (
		<span className="min-w-0 flex-1">
			<span className="flex items-baseline justify-between gap-2">
				<span
					className={cn(
						"flex min-w-0 items-center gap-1.5 truncate text-sm",
						unread ? "font-semibold text-fg" : "font-medium text-fg-muted",
					)}
				>
					{thread.trust === "vip" && (
						<span className="size-1.5 shrink-0 rounded-full bg-accent-2" />
					)}
					<span className="truncate">{thread.fromName}</span>
					{thread.messageCount != null && thread.messageCount > 1 && (
						<span className="shrink-0 text-2xs font-normal text-fg-subtle">
							{thread.messageCount}
						</span>
					)}
				</span>
				<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
					{thread.timeLabel}
				</span>
			</span>
			<span className="flex items-center gap-1.5">
				<span
					className={cn(
						"truncate text-sm",
						unread ? "text-fg" : "text-fg-muted",
					)}
				>
					{thread.subject}
				</span>
				{thread.suspicious && (
					<ShieldAlert className="size-3.5 shrink-0 text-danger" />
				)}
				{thread.starred && (
					<Star className="size-3 shrink-0 fill-warning text-warning" />
				)}
				{thread.hasAttachment && (
					<Paperclip className="size-3 shrink-0 text-fg-subtle" />
				)}
			</span>
			<span className="flex items-center gap-1.5">
				<span className="line-clamp-1 min-w-0 flex-1 text-xs text-fg-subtle">
					{thread.snippet}
				</span>
				{thread.category && thread.category !== "personal" && (
					<Badge tone={categoryTone[thread.category]} className="shrink-0">
						{thread.category}
					</Badge>
				)}
				{badge}
			</span>
		</span>
	);
}

/**
 * Full inner body of a comfortable row (unread dot + avatar + text content).
 * Place inside any wrapper element that uses `comfortableRowClass()`.
 */
export function ComfortableRowBody({ thread }: { thread: ThreadRowData }) {
	const unread = !thread.isRead;
	return (
		<>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
			<ComfortableRowTextContent thread={thread} />
		</>
	);
}

export function CompactRow({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			{...LIST_ROW_ATTRIBUTE}
			onClick={onClick}
			className={compactRowClass({ active })}
		>
			<CompactRowBody thread={thread} />
		</button>
	);
}

export function ComfortableRow({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			{...LIST_ROW_ATTRIBUTE}
			onClick={onClick}
			className={comfortableRowClass({ active })}
		>
			<ComfortableRowBody thread={thread} />
		</button>
	);
}

/** A row renderer the brief drives — Comfortable/Compact rows or a consumer's
 *  own (e.g. the web client's navigation-aware row) all satisfy this shape. */
export type BriefRowComponent = (props: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) => React.ReactNode;
