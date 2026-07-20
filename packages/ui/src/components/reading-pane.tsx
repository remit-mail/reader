import {
	ChevronDown,
	ChevronRight,
	Search,
	ShieldAlert,
	SquarePen,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { isSelfRowActivation } from "../lib/row-keyboard.js";
import type { ThreadData, ThreadMessageData } from "./app-shell-types.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { IntelligenceToggle } from "./intelligence-toggle.js";
import { MailActionToolbar } from "./mail-action-toolbar.js";
import { MessageBodyView } from "./message-body-view.js";
import { ReadingPaneEmpty } from "./reading-pane-empty.js";

/* ------------------------------------------------------------------ */
/* Pane 3: threaded reading pane                                      */
/* ------------------------------------------------------------------ */

/**
 * One collapsed thread row. Presentational and prop-driven: the kit owns the
 * row rhythm (shared `px-2`/`lg:px-4` gutter, leading chevron, `md` avatar,
 * fixed-width sender, snippet) and the app injects its interactivity via slots
 * — `onClick` to expand, `isFocused`/`isUnread` for the keyboard ring and
 * unread dot, and a `trailing` slot for the star/attachment/date cluster. With
 * no slots it renders the fixture date label so the kit stories stand alone.
 *
 * The row is a `role="button"` div rather than a native `<button>` so the
 * `trailing` slot can hold its own interactive controls (the star toggle) —
 * `<button>` inside `<button>` is invalid HTML and throws a hydration error
 * (#1232). Keyboard operation (Enter/Space) is wired by hand to keep the whole
 * row expandable, guarded so a keypress bubbling up from the star doesn't also
 * expand the row (`isSelfRowActivation`); the star stops click propagation so it
 * toggles on its own.
 */
export function CollapsedMessage({
	message,
	onClick,
	isFocused,
	isUnread,
	trailing,
}: {
	message: ThreadMessageData;
	/** Expand handler. Omit for a static (story / SSR) row. */
	onClick?: () => void;
	/** Keyboard-focus indicator (inset ring), independent of hover. */
	isFocused?: boolean;
	/** Bolds the sender and overlays the unread dot on the avatar. */
	isUnread?: boolean;
	/**
	 * Trailing cluster (star button, attachment icon, date). Replaces the kit's
	 * default fixture date label so the app can inject its real interactive
	 * controls without the kit importing app/data code.
	 */
	trailing?: ReactNode;
}) {
	const content = (
		<>
			<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
			<div className="relative shrink-0">
				<Avatar name={message.fromName} email={message.fromEmail} size="md" />
				{isUnread && (
					<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border border-canvas bg-accent" />
				)}
			</div>
			<span
				className={cn(
					"w-36 shrink-0 truncate text-sm",
					isUnread ? "font-semibold text-fg" : "font-medium text-fg-muted",
				)}
			>
				{message.fromName}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
				{message.snippet}
			</span>
			{trailing ?? (
				<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
					{message.dateLabel}
				</span>
			)}
		</>
	);

	const className = cn(
		"group flex h-section-row w-full items-center gap-3 border-b border-line px-2 text-left transition-colors hover:bg-surface-sunken lg:px-4",
		isFocused && "bg-surface-sunken ring-1 ring-inset ring-accent/30",
	);

	if (!onClick) {
		return <div className={className}>{content}</div>;
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: a nested <button> (the star in the trailing slot) inside a native <button> is invalid HTML and throws a hydration error (#1232); a role="button" div keeps the whole row keyboard-expandable while letting the star be its own control
		<div
			role="button"
			tabIndex={0}
			aria-expanded={false}
			onClick={onClick}
			onKeyDown={(e) => {
				if (!isSelfRowActivation(e)) return;
				e.preventDefault();
				onClick();
			}}
			className={cn(className, "cursor-pointer")}
		>
			{content}
		</div>
	);
}

/**
 * One expanded thread message. Presentational and prop-driven: the kit owns the
 * header rhythm (leading chevron, `md` avatar, sender block) and the body
 * spacing; the app injects its interactivity and real data via slots —
 * `onHeaderClick` to collapse, `isFocused`/`isUnread`, a `senderBadge` after the
 * name, `trailing` for the date, `to` for the recipient line, `indicators` for
 * the star/attachment row, `actionMenu` for the kebab, and `body` for the real
 * message body (loading/error/raw). With no `body` it renders the fixture
 * `MessageBodyView` so the kit stories stand alone.
 */
export function ExpandedMessage({
	message,
	warning,
	onHeaderClick,
	isFocused,
	senderBadge,
	trailing,
	to,
	indicators,
	actionMenu,
	actionBar,
	body,
}: {
	message: ThreadMessageData;
	warning?: string;
	/** Collapse handler on the sender block. Omit for a static row. */
	onHeaderClick?: () => void;
	isFocused?: boolean;
	/** Rendered after the sender name (e.g. a trusted-sender badge). */
	senderBadge?: ReactNode;
	/** Trailing header content (date). Defaults to the fixture date label. */
	trailing?: ReactNode;
	/** Recipient line. `undefined` → "to {message.toLabel}"; `null` → hidden. */
	to?: ReactNode;
	/** Row under the header (star / attachment / unread dot). */
	indicators?: ReactNode;
	/** Per-message action menu (kebab), right-aligned in the header. */
	actionMenu?: ReactNode;
	/**
	 * Per-message action bar (reply / triage), rendered between the header and the
	 * body. The narrow-width reading view puts the message's verbs here so they
	 * belong to this message; collapsed rows pass none.
	 */
	actionBar?: ReactNode;
	/**
	 * The message body. Replaces the kit's fixture `MessageBodyView` so the app
	 * can inject its real data-driven body (loading / error / raw toggle).
	 */
	body?: ReactNode;
}) {
	const sender = (
		<>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-sm font-semibold text-fg">
					{message.fromName}
					{senderBadge}
				</span>
				{trailing ?? (
					<span className="text-2xs text-fg-subtle">{message.dateLabel}</span>
				)}
			</div>
			<div className="text-xs text-fg-subtle">{message.fromEmail}</div>
			{to !== null && (
				<div className="text-xs text-fg-subtle">
					{to ?? <>to {message.toLabel}</>}
				</div>
			)}
		</>
	);

	return (
		<div
			className={cn(
				"px-2 py-3 lg:px-4",
				isFocused && "ring-1 ring-inset ring-accent/30",
			)}
		>
			<div className="flex items-start gap-3">
				<ChevronDown className="mt-1 size-3.5 shrink-0 text-fg-subtle" />
				<Avatar name={message.fromName} email={message.fromEmail} size="md" />
				<div className="min-w-0 flex-1">
					{onHeaderClick ? (
						<button
							type="button"
							onClick={onHeaderClick}
							className="w-full text-left"
						>
							{sender}
						</button>
					) : (
						sender
					)}
					{indicators}
				</div>
				{actionMenu && <div className="shrink-0">{actionMenu}</div>}
			</div>

			{warning && (
				<div className="mt-3 flex items-start gap-3 rounded-md bg-danger-soft p-3">
					<ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
					<div className="text-sm text-fg">
						<span className="font-semibold text-danger">Caution: </span>
						{warning}{" "}
						<button type="button" className="text-accent underline">
							Why?
						</button>
					</div>
				</div>
			)}

			{actionBar && <div className="mt-3 -mx-2 lg:-mx-4">{actionBar}</div>}

			{/* The body is injected by the app (real sanitize → classify →
			    sandboxed-iframe pipeline via its MessageBody). With no `body`
			    slot the kit renders MessageBodyView directly so Storybook shows
			    exactly what the app renders, not a divergent inline-HTML mock
			    (#940). `framed` fixtures map to the newsletter treatment (author
			    colors preserved); the rest render plain. */}
			{body ?? (
				<MessageBodyView
					className="mt-3"
					html={message.bodyHtml}
					category={message.framed ? "newsletter" : "personal"}
					allowImages
				/>
			)}
		</div>
	);
}

/**
 * Message action toolbar on the pane-header datum: the reading pane's
 * verbs (reply/reply-all/forward, delete/move/flag) plus search and
 * compose, Apple Mail-style above the message area. Built on the shared
 * `MailActionToolbar` so the mail verbs stay pressable with no
 * thread open and explain inline rather than greying out (the never-disable
 * tenet). The intelligence toggle is the exception: it holds its slot and greys
 * out when there is no rail to open (#52).
 */
function MessageToolbar({
	hasThread,
	intelligenceOpen,
	onToggleIntelligence,
	canToggleIntelligence = false,
}: {
	hasThread: boolean;
	intelligenceOpen?: boolean;
	onToggleIntelligence?: () => void;
	canToggleIntelligence?: boolean;
}) {
	const [hint, setHint] = useState<string | null>(null);
	return (
		<MailActionToolbar
			hasThread={hasThread}
			onUnavailable={() => setHint("Open a message first")}
			unavailableHint={hint}
		>
			{/* Apple Mail geometry: search sits top-right over the message
			    area but still filters the current list / brief */}
			<Input
				icon={<Search className="size-4" />}
				placeholder="Search mail"
				className="h-8 w-64 min-w-40 shrink"
			/>
			<span className="mx-1 h-4 w-px bg-line" aria-hidden />
			<Button
				variant="ghost"
				size="sm"
				icon={<SquarePen className="size-4" />}
				title="Compose (⌘N)"
				aria-label="Compose"
			/>
			<IntelligenceToggle
				open={intelligenceOpen}
				enabled={canToggleIntelligence}
				onToggle={onToggleIntelligence}
			/>
		</MailActionToolbar>
	);
}

export function ReadingPane({
	thread,
	intelligenceOpen,
	onToggleIntelligence,
	canToggleIntelligence,
}: {
	thread?: ThreadData;
	intelligenceOpen?: boolean;
	onToggleIntelligence?: () => void;
	canToggleIntelligence?: boolean;
}) {
	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={Boolean(thread)}
				intelligenceOpen={intelligenceOpen}
				onToggleIntelligence={onToggleIntelligence}
				canToggleIntelligence={canToggleIntelligence}
			/>

			{!thread ? (
				<ReadingPaneEmpty />
			) : (
				<div className="flex-1 overflow-y-auto">
					{/* subject lives with the content, Apple Mail-style: once per
					    thread, scrolls with the message */}
					<div className="border-b border-line px-5 pt-5 pb-3">
						<h2 className="max-w-2xl text-lg font-semibold leading-snug text-fg">
							{thread.subject}
						</h2>
						<p className="mt-1 text-2xs text-fg-subtle">
							{thread.messages.length}{" "}
							{thread.messages.length === 1 ? "message" : "messages"}
						</p>
					</div>

					{thread.messages.map((message) =>
						message.expanded ? (
							<ExpandedMessage
								key={message.id}
								message={message}
								warning={thread.warning}
							/>
						) : (
							<CollapsedMessage key={message.id} message={message} />
						),
					)}
				</div>
			)}
		</article>
	);
}
