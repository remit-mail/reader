import {
	Archive,
	BellOff,
	ChevronDown,
	ChevronRight,
	FolderInput,
	Forward,
	Inbox,
	Info,
	Paperclip,
	Reply,
	ReplyAll,
	Search,
	Send,
	Settings,
	ShieldAlert,
	Sparkles,
	SquarePen,
	Star,
	Trash2,
} from "lucide-react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import {
	type IntelligenceData,
	IntelligencePanel,
	type SenderTrustLevel,
} from "./intelligence-panel.js";
import { Kbd } from "./kbd.js";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "./resizable.js";

/* ------------------------------------------------------------------ */
/* The 4-pane desktop shell:                                          */
/*   nav sidebar | message list | reading pane | intelligence sidebar */
/* Pane 4 collapses to the classic 3-pane. Fixture-driven; every      */
/* visual decision is token-based.                                    */
/* ------------------------------------------------------------------ */

export interface NavMailbox {
	id: string;
	name: string;
	unseen?: number;
}

export interface NavAccount {
	id: string;
	label: string;
	email: string;
	/** Muted: excluded from unified views, still syncing. Rendered dimmed. */
	muted?: boolean;
	mailboxes: NavMailbox[];
}

export type ThreadCategory =
	| "personal"
	| "newsletter"
	| "marketing"
	| "automated"
	| "transactional"
	| "social";

export interface ThreadRowData {
	id: string;
	accountId: string;
	fromName: string;
	fromEmail: string;
	subject: string;
	snippet: string;
	timeLabel: string;
	isRead?: boolean;
	hasAttachment?: boolean;
	starred?: boolean;
	trust?: SenderTrustLevel;
	category?: ThreadCategory;
	/** Number of messages when the row is a thread. */
	messageCount?: number;
	/** Authenticity heuristics flagged this row (DKIM/From mismatch). */
	suspicious?: boolean;
}

export interface ThreadSection {
	id: string;
	/** Section label; omit for a flat list. */
	label?: string;
	threads: ThreadRowData[];
}

export interface AccountChip {
	id: string;
	label: string;
	count?: number;
	active?: boolean;
}

export interface ThreadMessageData {
	id: string;
	fromName: string;
	fromEmail: string;
	toLabel: string;
	dateLabel: string;
	snippet: string;
	bodyHtml: string;
	expanded?: boolean;
	/**
	 * Designed HTML mail (newsletters/marketing): render the body inside a
	 * hairline content frame that hugs left. The email keeps its own colors
	 * inside the frame (never dark-inverted); the frame contains the
	 * brightness so a white 600px blast doesn't glow to the pane edge.
	 */
	framed?: boolean;
}

export interface ThreadData {
	subject: string;
	messages: ThreadMessageData[];
	/** Danger banner above the body (authenticity verdicts only). */
	warning?: string;
}

export type Density = "comfortable" | "compact";

export interface AppShellProps {
	accounts: NavAccount[];
	/** "brief" or a mailbox id. */
	selectedNavId: string;
	briefUnseen?: number;
	listTitle: string;
	listMeta?: string;
	/** Account segmentation chips (daily brief). */
	chips?: AccountChip[];
	/** Subtle muted affordance, e.g. "+1 muted". */
	mutedNote?: string;
	sections: ThreadSection[];
	selectedThreadId?: string;
	thread?: ThreadData;
	intelligence?: IntelligenceData;
	/** Pane 4 visible. Defaults to true when intelligence is present. */
	intelligenceOpen?: boolean;
	density?: Density;
	onSelectNav?: (id: string) => void;
	onSelectThread?: (id: string) => void;
	onToggleIntelligence?: () => void;
}

const categoryTone: Record<
	ThreadCategory,
	"neutral" | "accent" | "positive" | "warning"
> = {
	personal: "accent",
	newsletter: "neutral",
	marketing: "neutral",
	automated: "neutral",
	transactional: "positive",
	social: "warning",
};

/* ------------------------------------------------------------------ */
/* Pane 1: navigation sidebar                                         */
/* ------------------------------------------------------------------ */

function NavItem({
	icon,
	label,
	count,
	active,
	dimmed,
	indent,
	onClick,
}: {
	icon?: React.ReactNode;
	label: string;
	count?: number;
	active?: boolean;
	dimmed?: boolean;
	indent?: boolean;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
				indent && "pl-7",
				active
					? "bg-accent-2-soft font-medium text-accent-2"
					: "text-fg-muted hover:bg-surface hover:text-fg",
				dimmed && "opacity-55",
			)}
		>
			{icon && (
				<span
					className={cn(
						"shrink-0",
						active ? "text-accent-2" : "text-fg-subtle",
					)}
				>
					{icon}
				</span>
			)}
			<span className="flex-1 truncate">{label}</span>
			{count != null && count > 0 && (
				<span
					className={cn(
						"text-2xs tabular-nums",
						active ? "text-accent-2" : "text-fg-subtle",
					)}
				>
					{count}
				</span>
			)}
		</button>
	);
}

function NavSidebar({
	accounts,
	selectedNavId,
	briefUnseen,
	onSelectNav,
}: Pick<
	AppShellProps,
	"accounts" | "selectedNavId" | "briefUnseen" | "onSelectNav"
>) {
	return (
		<aside className="flex h-full w-full flex-col bg-surface-sunken">
			{/* no toolbar over the sidebar (Apple Mail-style): nav content
			    starts at the top; the datum bar exists only over the
			    list/reading/intelligence panes */}
			<nav className="flex-1 overflow-y-auto px-2 py-2">
				<NavItem
					icon={<Sparkles className="size-4" />}
					label="Daily brief"
					count={briefUnseen}
					active={selectedNavId === "brief"}
					onClick={() => onSelectNav?.("brief")}
				/>

				{accounts.map((account) => (
					<div key={account.id} className="mt-3">
						<div
							className={cn(
								"flex items-center gap-1.5 px-2 pb-1",
								account.muted && "opacity-55",
							)}
						>
							<span className="truncate text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
								{account.label}
							</span>
							{account.muted && (
								<>
									<BellOff className="size-3 shrink-0 text-fg-subtle" />
									<span className="text-2xs text-fg-subtle">muted</span>
								</>
							)}
						</div>
						{account.mailboxes.map((mb) => (
							<NavItem
								key={mb.id}
								icon={
									mb.name === "Sent" ? (
										<Send className="size-4" />
									) : (
										<Inbox className="size-4" />
									)
								}
								label={mb.name}
								count={mb.unseen}
								active={selectedNavId === mb.id}
								dimmed={account.muted}
								onClick={() => onSelectNav?.(mb.id)}
							/>
						))}
					</div>
				))}
			</nav>

			<div className="border-t border-line px-2 py-2">
				<NavItem icon={<Settings className="size-4" />} label="Settings" />
			</div>
		</aside>
	);
}

/* ------------------------------------------------------------------ */
/* Pane 2: message list (sectioned, dense, density toggle)            */
/* ------------------------------------------------------------------ */

function CompactRow({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) {
	const unread = !thread.isRead;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex h-8 w-full items-center gap-2 px-row-inset text-left",
				active ? "bg-accent-2-soft" : "hover:bg-surface-sunken",
			)}
		>
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
		</button>
	);
}

function ComfortableRow({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) {
	const unread = !thread.isRead;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				// full-bleed highlight; content inset with a clear unread-dot gutter
				"relative flex w-full items-start gap-3 py-2 pl-5 pr-row-inset text-left transition-colors",
				active ? "bg-accent-2-soft" : "hover:bg-surface-sunken",
			)}
		>
			{unread && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}
			<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
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
				</span>
			</span>
		</button>
	);
}

function MessageListPane({
	listTitle,
	listMeta,
	chips,
	mutedNote,
	sections,
	selectedThreadId,
	density = "comfortable",
	onSelectThread,
}: Pick<
	AppShellProps,
	| "listTitle"
	| "listMeta"
	| "chips"
	| "mutedNote"
	| "sections"
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
>) {
	const Row = density === "compact" ? CompactRow : ComfortableRow;
	return (
		<section className="flex h-full w-full flex-col bg-surface">
			{/* list datum bar: title + unread count — the list's context lives
			    on the datum; search moved to the message toolbar (Apple Mail
			    geometry) but still filters this list */}
			<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
				<h1 className="truncate text-sm font-semibold text-fg">{listTitle}</h1>
				{listMeta && (
					<span className="shrink-0 text-2xs text-fg-subtle">{listMeta}</span>
				)}
			</header>

			{/* secondary row only when account chips exist (the brief) */}
			{chips && chips.length > 0 && (
				<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1">
					{chips.map((chip) => (
						<button
							key={chip.id}
							type="button"
							className={cn(
								"flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
								chip.active
									? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
									: "border-line text-fg-muted hover:border-line-strong",
							)}
						>
							{chip.label}
							{chip.count != null && (
								<span className="tabular-nums opacity-70">{chip.count}</span>
							)}
						</button>
					))}
					{mutedNote && (
						<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
							{mutedNote}
						</span>
					)}
				</div>
			)}

			<div className="flex-1 overflow-y-auto">
				{sections.map((section) => (
					<div key={section.id}>
						{section.label && (
							<div className="sticky top-0 flex items-baseline justify-between border-b border-line bg-surface-sunken px-row-inset py-1">
								<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
									{section.label}
								</span>
								<span className="text-2xs text-fg-subtle tabular-nums">
									{section.threads.length}
								</span>
							</div>
						)}
						<div className="divide-y divide-line">
							{section.threads.map((thread) => (
								<Row
									key={thread.id}
									thread={thread}
									active={thread.id === selectedThreadId}
									onClick={() => onSelectThread?.(thread.id)}
								/>
							))}
						</div>
					</div>
				))}
			</div>

			<footer className="flex items-center gap-2 border-t border-line px-row-inset py-1 text-2xs text-fg-subtle">
				<Kbd>j</Kbd>
				<Kbd>k</Kbd>
				<span>navigate</span>
				<Kbd>e</Kbd>
				<span>archive</span>
				<Kbd>m</Kbd>
				<span>mute</span>
				<Kbd>?</Kbd>
				<span>all shortcuts</span>
			</footer>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Pane 3: threaded reading pane                                      */
/* ------------------------------------------------------------------ */

function CollapsedMessage({ message }: { message: ThreadMessageData }) {
	return (
		<button
			type="button"
			className="flex w-full items-center gap-3 border-b border-line px-5 py-2 text-left hover:bg-surface-sunken"
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

function ExpandedMessage({
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

			{message.framed ? (
				// Designed HTML mail: hairline frame anchored left, the email's
				// own (light) colors contained inside — never dark-inverted.
				<div className="mt-3 max-w-2xl overflow-hidden rounded-sm border border-line bg-surface-sunken">
					<div
						// biome-ignore lint/security/noDangerouslySetInnerHtml: fixture HTML only, no user input in the workbench
						dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
					/>
				</div>
			) : (
				// Plain mail: left-aligned, comfortable measure, whitespace right.
				<div
					className="mt-3 max-w-2xl text-md leading-relaxed text-fg [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: fixture HTML only, no user input in the workbench
					dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
				/>
			)}
		</div>
	);
}

/**
 * Message action toolbar on the pane-header datum: the reading pane's
 * verbs (reply/reply-all/forward, archive/delete/move/flag) plus
 * compose, Apple Mail-style above the message area. Ghost icon
 * buttons, tooltips carry shortcuts; actions dim when nothing is open.
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
	return (
		<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<Reply className="size-4" />}
				title="Reply (r)"
				aria-label="Reply"
			/>
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<ReplyAll className="size-4" />}
				title="Reply all (a)"
				aria-label="Reply all"
			/>
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<Forward className="size-4" />}
				title="Forward (f)"
				aria-label="Forward"
			/>
			<span className="mx-1 h-4 w-px bg-line" aria-hidden />
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<Archive className="size-4" />}
				title="Archive (e)"
				aria-label="Archive"
			/>
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<Trash2 className="size-4" />}
				title="Delete (#)"
				aria-label="Delete"
			/>
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<FolderInput className="size-4" />}
				title="Move to mailbox"
				aria-label="Move to mailbox"
			/>
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<Star className="size-4" />}
				title="Flag (s)"
				aria-label="Flag"
			/>
			<div className="flex-1" />
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
		</header>
	);
}

function ReadingPane({
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
				<div className="flex flex-1 flex-col items-center justify-center text-center">
					<Inbox className="size-10 text-fg-subtle" />
					<p className="mt-3 text-sm text-fg-muted">Select a thread to read</p>
					<p className="text-2xs text-fg-subtle">
						<Kbd>j</Kbd> / <Kbd>k</Kbd> to move, <Kbd>Enter</Kbd> to open
					</p>
				</div>
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

					<div className="flex gap-2 border-t border-line px-5 py-3">
						<Button
							variant="secondary"
							size="sm"
							icon={<Reply className="size-3.5" />}
						>
							Reply
						</Button>
						<Button
							variant="secondary"
							size="sm"
							icon={<ReplyAll className="size-3.5" />}
						>
							Reply all
						</Button>
						<Button
							variant="secondary"
							size="sm"
							icon={<Forward className="size-3.5" />}
						>
							Forward
						</Button>
					</div>
				</div>
			)}
		</article>
	);
}

/* ------------------------------------------------------------------ */
/* Composite shell                                                    */
/* ------------------------------------------------------------------ */

export function AppShell({
	accounts,
	selectedNavId,
	briefUnseen,
	listTitle,
	listMeta,
	chips,
	mutedNote,
	sections,
	selectedThreadId,
	thread,
	intelligence,
	intelligenceOpen = true,
	density,
	onSelectNav,
	onSelectThread,
	onToggleIntelligence,
}: AppShellProps) {
	const showIntelligence =
		Boolean(intelligence) && intelligenceOpen && Boolean(thread);
	return (
		<div className="flex h-dvh w-full overflow-hidden bg-canvas font-sans text-fg">
			{/* Resizable panes: drag handles ARE the hairlines between panes.
			    Sizes are percentages (library constraint) tuned to the old
			    fixed widths at ~1440px. Layout persistence (autoSaveId →
			    user preference storage) is future work, see README. */}
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel
					id="nav"
					order={1}
					defaultSize={17}
					minSize={12}
					maxSize={24}
					className="min-w-0"
				>
					<NavSidebar
						accounts={accounts}
						selectedNavId={selectedNavId}
						briefUnseen={briefUnseen}
						onSelectNav={onSelectNav}
					/>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel
					id="list"
					order={2}
					defaultSize={density === "compact" ? 36 : 27}
					minSize={18}
					maxSize={48}
					className="min-w-0"
				>
					<MessageListPane
						listTitle={listTitle}
						listMeta={listMeta}
						chips={chips}
						mutedNote={mutedNote}
						sections={sections}
						selectedThreadId={selectedThreadId}
						density={density}
						onSelectThread={onSelectThread}
					/>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="reading" order={3} minSize={24} className="min-w-0">
					<ReadingPane
						thread={thread}
						intelligenceOpen={showIntelligence}
						onToggleIntelligence={onToggleIntelligence}
						showIntelligenceToggle={Boolean(intelligence) && Boolean(thread)}
					/>
				</ResizablePanel>
				{showIntelligence && intelligence && (
					<>
						<ResizableHandle />
						<ResizablePanel
							id="intelligence"
							order={4}
							defaultSize={21}
							minSize={15}
							maxSize={32}
							className="min-w-0"
						>
							<IntelligencePanel
								data={intelligence}
								onClose={onToggleIntelligence}
								className="h-full w-full border-l-0"
							/>
						</ResizablePanel>
					</>
				)}
			</ResizablePanelGroup>
		</div>
	);
}
