import { Check, Paperclip, ShieldAlert, Star } from "lucide-react";
import type {
	ComponentType,
	MouseEvent,
	ReactNode,
	SyntheticEvent,
} from "react";
import { cn } from "../lib/cn.js";
import { ROW_ATTRIBUTE } from "../lib/keymap-dispatch.js";
import { LIST_ROW_ATTRIBUTE } from "../lib/roving-focus.js";
import { categoryTone, type ThreadRowData } from "./app-shell-types.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { LabelChip } from "./label-chip.js";

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
				<Paperclip
					className="size-3 shrink-0 text-fg-subtle"
					role="img"
					aria-label="Has an attachment"
				/>
			)}
			<span className="w-11 shrink-0 text-right text-2xs text-fg-subtle tabular-nums">
				{thread.timeLabel}
			</span>
		</>
	);
}

/**
 * Bold the literal (case-insensitive) occurrences of `query` in `text`. Used by
 * the search rows so a match is visible in the subject and snippet it was found
 * in; an absent or blank query leaves the text alone.
 */
function highlightMatches(text: string, query?: string): ReactNode {
	const term = query?.trim();
	if (!term) return text;
	const lower = text.toLowerCase();
	const needle = term.toLowerCase();
	const parts: ReactNode[] = [];
	let cursor = 0;
	let match = lower.indexOf(needle, cursor);
	let key = 0;
	while (match !== -1) {
		if (match > cursor) parts.push(text.slice(cursor, match));
		parts.push(
			<mark key={key++} className="bg-transparent font-semibold text-fg">
				{text.slice(match, match + needle.length)}
			</mark>,
		);
		cursor = match + needle.length;
		match = lower.indexOf(needle, cursor);
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
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
	highlightQuery,
}: {
	thread: ThreadRowData;
	/** Extra chip rendered after the category badge (e.g. an auto-moved indicator). */
	badge?: ReactNode;
	/** Bold this term where it occurs literally in the subject and snippet. */
	highlightQuery?: string;
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
					{highlightMatches(thread.subject, highlightQuery)}
				</span>
				{thread.suspicious && (
					<ShieldAlert className="size-3.5 shrink-0 text-danger" />
				)}
				{thread.starred && (
					<Star className="size-3 shrink-0 fill-warning text-warning" />
				)}
				{thread.hasAttachment && (
					<Paperclip
						className="size-3 shrink-0 text-fg-subtle"
						role="img"
						aria-label="Has an attachment"
					/>
				)}
			</span>
			<span className="flex items-center gap-1.5">
				<span className="line-clamp-1 min-w-0 flex-1 text-xs text-fg-subtle">
					{highlightMatches(thread.snippet, highlightQuery)}
				</span>
				{thread.category && thread.category !== "personal" && (
					<Badge tone={categoryTone[thread.category]} className="shrink-0">
						{thread.category}
					</Badge>
				)}
				{thread.labels?.map((label) => (
					<LabelChip key={label.labelId} label={label} className="max-w-20" />
				))}
				{badge}
			</span>
		</span>
	);
}

/**
 * Checkbox state for a selectable row. Absent on a row that cannot be
 * multi-selected (the brief and Flagged before they gained selection), which
 * renders the avatar alone.
 */
/** What the toggle handler needs off the click or keypress that triggered it. */
export type RowToggleEvent = Pick<
	SyntheticEvent,
	"preventDefault" | "stopPropagation"
>;

export interface RowSelection {
	checked: boolean;
	/** Keep the checkbox visible instead of revealing it on hover (mobile). */
	alwaysVisible?: boolean;
	onToggle: (event: RowToggleEvent) => void;
}

/**
 * Leading slot of a comfortable row: the avatar, with a checkbox layered over
 * it when the row is selectable. Fixed 28px so the row never reflows as the
 * checkbox appears.
 */
export function ComfortableRowLeading({
	thread,
	selection,
}: {
	thread: ThreadRowData;
	selection?: RowSelection;
}) {
	if (!selection) {
		return <Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />;
	}
	const { checked, alwaysVisible } = selection;
	return (
		<span className="relative size-7 shrink-0">
			<Avatar
				name={thread.fromName}
				email={thread.fromEmail}
				size="sm"
				className={cn(
					"absolute inset-0 transition-opacity sm:group-hover:opacity-0",
					(checked || alwaysVisible) && "opacity-0",
				)}
			/>
			{/* A span, not a <button>: the row itself is a button (the brief,
			    Flagged) or a link (the mailbox list), and neither may nest an
			    interactive element. The button role and label are what the user and
			    the test suite address, so both stay. */}
			{/* biome-ignore lint/a11y/useSemanticElements: a nested <button> inside the row's own button/link is invalid HTML */}
			<span
				role="button"
				// Out of the tab order: the row is the list's single tab stop, and this
				// control is `opacity-0` until hover, so a tabbable one would put focus
				// on something invisible on every row.
				tabIndex={-1}
				onClick={selection.onToggle}
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					event.stopPropagation();
					selection.onToggle(event);
				}}
				className={cn(
					"absolute inset-0 size-7 items-center justify-center rounded-full border transition-opacity",
					alwaysVisible ? "flex" : "hidden sm:flex",
					checked
						? "bg-accent border-accent text-accent-fg opacity-100"
						: alwaysVisible
							? "border-fg-subtle/40 bg-canvas opacity-100"
							: "border-fg-subtle/40 bg-canvas opacity-0 group-hover:opacity-100",
				)}
				aria-label={checked ? "Deselect message" : "Select message"}
			>
				{checked && <Check className="size-3" />}
			</span>
		</span>
	);
}

/**
 * Full inner body of a comfortable row (unread dot + leading slot + text
 * content). Place inside any wrapper element that uses `comfortableRowClass()`.
 */
export function ComfortableRowBody({
	thread,
	selection,
	badge,
	highlightQuery,
}: {
	thread: ThreadRowData;
	selection?: RowSelection;
	badge?: ReactNode;
	/** Bold this term where it occurs literally in the subject and snippet. */
	highlightQuery?: string;
}) {
	const unread = !thread.isRead;
	return (
		<>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<ComfortableRowLeading thread={thread} selection={selection} />
			<ComfortableRowTextContent
				thread={thread}
				badge={badge}
				highlightQuery={highlightQuery}
			/>
		</>
	);
}

/**
 * What marks a row as a row: the roving-focus marker, the message-list marker
 * the keyboard layer reads to leave Enter and Space with the list rather than
 * with the button under focus, and the id the cursor finds it by. The app's own
 * row carries the same three (`MessageRow`), so a key pressed on a kit row does
 * what it does on an app row.
 */
const rowMarkers = (thread: ThreadRowData) => ({
	...LIST_ROW_ATTRIBUTE,
	[ROW_ATTRIBUTE]: "",
	"data-message-id": thread.id,
});

export function CompactRow({
	thread,
	active,
	focused,
	tabIndex,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	focused?: boolean;
	tabIndex?: number;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			{...rowMarkers(thread)}
			tabIndex={tabIndex}
			onClick={onClick}
			className={compactRowClass({ active, focused })}
		>
			<CompactRowBody thread={thread} />
		</button>
	);
}

export function ComfortableRow({
	thread,
	active,
	focused,
	tabIndex,
	selection,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	focused?: boolean;
	tabIndex?: number;
	selection?: RowSelection;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			{...rowMarkers(thread)}
			tabIndex={tabIndex}
			onClick={onClick}
			className={cn("group", comfortableRowClass({ active, focused }))}
		>
			<ComfortableRowBody thread={thread} selection={selection} />
		</button>
	);
}

/** A row renderer the brief drives — Comfortable/Compact rows or a consumer's
 *  own (e.g. the web client's navigation-aware row) all satisfy this shape. */
export type BriefRowComponent = ComponentType<{
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}>;
