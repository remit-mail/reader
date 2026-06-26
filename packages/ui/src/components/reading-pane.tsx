import {
	ChevronDown,
	ChevronRight,
	Info,
	Search,
	ShieldAlert,
	SquarePen,
} from "lucide-react";
import { useState } from "react";
import type { ThreadData, ThreadMessageData } from "./app-shell-types.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { MailActionToolbar } from "./mail-action-toolbar.js";
import { MessageBodyView } from "./message-body-view.js";
import { ReadingPaneEmpty } from "./reading-pane-empty.js";

/* ------------------------------------------------------------------ */
/* Pane 3: threaded reading pane                                      */
/* ------------------------------------------------------------------ */

export function CollapsedMessage({ message }: { message: ThreadMessageData }) {
	return (
		<button
			type="button"
			className="flex h-section-row w-full items-center gap-3 border-b border-line px-5 text-left hover:bg-surface-sunken"
		>
			<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
			<Avatar name={message.fromName} email={message.fromEmail} size="sm" />
			<span className="w-36 shrink-0 truncate text-sm font-medium text-fg-muted">
				{message.fromName}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
				{message.snippet}
			</span>
			<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
				{message.dateLabel}
			</span>
		</button>
	);
}

export function ExpandedMessage({
	message,
	warning,
}: {
	message: ThreadMessageData;
	warning?: string;
}) {
	return (
		<div className="px-5 py-3">
			<div className="flex items-start gap-3">
				<Avatar name={message.fromName} email={message.fromEmail} size="md" />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-sm font-semibold text-fg">
							{message.fromName}
						</span>
						<span className="text-2xs text-fg-subtle">{message.dateLabel}</span>
					</div>
					<div className="text-xs text-fg-subtle">{message.fromEmail}</div>
					<div className="text-xs text-fg-subtle">to {message.toLabel}</div>
				</div>
				<ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
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

			{/* Render through the real sanitize → classify → sandboxed-iframe
			    pipeline so Storybook shows exactly what the app renders, not a
			    divergent inline-HTML mock (#940). `framed` fixtures map to the
			    newsletter treatment (author colors preserved); the rest render
			    plain. External images are allowed in the kit reference. */}
			<MessageBodyView
				className="mt-3"
				html={message.bodyHtml}
				category={message.framed ? "newsletter" : "personal"}
				allowImages
			/>
		</div>
	);
}

/**
 * Message action toolbar on the pane-header datum: the reading pane's
 * verbs (reply/reply-all/forward, archive/delete/move/flag) plus search and
 * compose, Apple Mail-style above the message area. Built on the shared
 * `MailActionToolbar` so the buttons stay pressable with no thread open and
 * explain inline rather than greying out (the never-disable tenet).
 */
function MessageToolbar({
	hasThread,
	intelligenceOpen,
	onToggleIntelligence,
	showIntelligenceToggle,
}: {
	hasThread: boolean;
	intelligenceOpen?: boolean;
	onToggleIntelligence?: () => void;
	showIntelligenceToggle?: boolean;
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
			{showIntelligenceToggle && !intelligenceOpen && (
				<Button
					variant="ghost"
					size="sm"
					icon={<Info className="size-4" />}
					onClick={onToggleIntelligence}
					aria-label="Show intelligence sidebar"
				/>
			)}
		</MailActionToolbar>
	);
}

export function ReadingPane({
	thread,
	intelligenceOpen,
	onToggleIntelligence,
	showIntelligenceToggle,
}: {
	thread?: ThreadData;
	intelligenceOpen?: boolean;
	onToggleIntelligence?: () => void;
	showIntelligenceToggle?: boolean;
}) {
	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={Boolean(thread)}
				intelligenceOpen={intelligenceOpen}
				onToggleIntelligence={onToggleIntelligence}
				showIntelligenceToggle={showIntelligenceToggle}
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
