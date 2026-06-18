import {
	AlertOctagon,
	Archive,
	BellOff,
	ChevronDown,
	ChevronRight,
	FileText,
	Folder,
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
import { useEffect, useState } from "react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
} from "./filter-sheet.js";
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

/** True at ≥1024px (Tailwind `lg:`). Matches the mobile-chrome boundary used
 *  throughout the app — keep in sync with the CSS `lg:hidden` gates. */
function useIsDesktop(): boolean {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia("(min-width: 1024px)").matches;
	});
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia("(min-width: 1024px)");
		const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
		setMatches(mql.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);
	return matches;
}

/* ------------------------------------------------------------------ */
/* The 4-pane desktop shell:                                          */
/*   nav sidebar | message list | reading pane | intelligence sidebar */
/* Pane 4 collapses to the classic 3-pane. Fixture-driven; every      */
/* visual decision is token-based.                                    */
/* ------------------------------------------------------------------ */

/**
 * RFC 6154 / RFC 9051 special-use designations. Mirrors the generated
 * `MailboxSpecialUse` enum (@remit/domain-enums) by value; replace this local
 * union with the generated import once that package is wired into the UI build.
 * Inbox carries no special-use attribute (identified by name per the RFC).
 */
export type MailboxSpecialUse =
	| "\\All"
	| "\\Archive"
	| "\\Drafts"
	| "\\Flagged"
	| "\\Junk"
	| "\\Sent"
	| "\\Trash"
	| "\\Important";

export interface NavMailbox {
	id: string;
	name: string;
	unseen?: number;
	/** Denormalized IMAP SPECIAL-USE attributes; empty/absent = custom folder. */
	specialUse?: MailboxSpecialUse[];
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

/** "all" (no category narrowing) plus every content-type category. */
export type BriefCategoryFilter = ThreadCategory | "all";

/**
 * Ordered content-type categories for the brief expando. Mirrors the generated
 * `MessageCategory` enum (@remit/domain-enums); swap this local list for the
 * generated enum's values once that package is importable from the UI build.
 */
export const briefCategories: ReadonlyArray<{
	id: BriefCategoryFilter;
	label: string;
}> = [
	{ id: "all", label: "All" },
	{ id: "personal", label: "Personal" },
	{ id: "newsletter", label: "Newsletters" },
	{ id: "marketing", label: "Marketing" },
	{ id: "automated", label: "Automated" },
	{ id: "transactional", label: "Transactional" },
	{ id: "social", label: "Social" },
];

export interface ThreadRowData {
	id: string;
	accountId: string;
	fromName: string;
	fromEmail: string;
	subject: string;
	snippet: string;
	timeLabel: string;
	/** Unix epoch ms — used by the "Today" brief filter; absent in fixture rows. */
	sentDate?: number;
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
	/** Brief mode: collapsible section headers + a composable filter chip bar. */
	briefFilters?: boolean;
	/**
	 * Content-type category filter for the brief (a separate axis from the
	 * in-list chips). Selecting one narrows the brief to that category.
	 */
	briefCategory?: BriefCategoryFilter;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
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

export const categoryTone: Record<
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

/* System mailboxes render in a fixed, scannable order; everything without a
   special-use attribute is a custom folder shown under a collapsible header.
   Inbox has no special-use attribute (matched by name per RFC 6154). */
const systemOrder: ReadonlyArray<MailboxSpecialUse | "INBOX"> = [
	"INBOX",
	"\\Drafts",
	"\\Sent",
	"\\Archive",
	"\\Junk",
	"\\Trash",
];

function systemKind(mb: NavMailbox): MailboxSpecialUse | "INBOX" | null {
	if (mb.specialUse && mb.specialUse.length > 0) return mb.specialUse[0];
	if (mb.name === "Inbox") return "INBOX";
	return null;
}

function systemIcon(kind: MailboxSpecialUse | "INBOX") {
	if (kind === "INBOX") return <Inbox className="size-4" />;
	if (kind === "\\Drafts") return <FileText className="size-4" />;
	if (kind === "\\Sent") return <Send className="size-4" />;
	if (kind === "\\Archive") return <Archive className="size-4" />;
	if (kind === "\\Junk") return <AlertOctagon className="size-4" />;
	if (kind === "\\Trash") return <Trash2 className="size-4" />;
	return <Folder className="size-4" />;
}

const FOLDER_COLLAPSE_THRESHOLD = 8;

function AccountNav({
	account,
	selectedNavId,
	onSelectNav,
}: {
	account: NavAccount;
	selectedNavId: string;
	onSelectNav?: (id: string) => void;
}) {
	const [foldersOpen, setFoldersOpen] = useState(true);
	const [showAllFolders, setShowAllFolders] = useState(false);

	const system = account.mailboxes
		.filter((mb) => systemKind(mb) !== null)
		.sort(
			(a, b) =>
				systemOrder.indexOf(systemKind(a) as MailboxSpecialUse | "INBOX") -
				systemOrder.indexOf(systemKind(b) as MailboxSpecialUse | "INBOX"),
		);
	const folders = account.mailboxes.filter((mb) => systemKind(mb) === null);
	const visibleFolders =
		showAllFolders || folders.length <= FOLDER_COLLAPSE_THRESHOLD
			? folders
			: folders.slice(0, FOLDER_COLLAPSE_THRESHOLD);
	const hiddenCount = folders.length - visibleFolders.length;

	return (
		<div className="mt-3">
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

			{system.map((mb) => (
				<NavItem
					key={mb.id}
					icon={systemIcon(systemKind(mb) as MailboxSpecialUse | "INBOX")}
					label={mb.name}
					count={mb.unseen}
					active={selectedNavId === mb.id}
					dimmed={account.muted}
					onClick={() => onSelectNav?.(mb.id)}
				/>
			))}

			{folders.length > 0 && (
				<>
					<button
						type="button"
						onClick={() => setFoldersOpen((open) => !open)}
						className="mt-1 flex w-full items-center gap-1 px-2 py-1 text-left text-2xs font-semibold uppercase tracking-wider text-fg-subtle transition-colors hover:text-fg"
					>
						{foldersOpen ? (
							<ChevronDown className="size-3 shrink-0" />
						) : (
							<ChevronRight className="size-3 shrink-0" />
						)}
						<span className="flex-1">Folders</span>
						<span className="tabular-nums opacity-70">{folders.length}</span>
					</button>
					{foldersOpen && (
						<>
							{visibleFolders.map((mb) => (
								<NavItem
									key={mb.id}
									icon={<Folder className="size-4" />}
									label={mb.name}
									count={mb.unseen}
									active={selectedNavId === mb.id}
									dimmed={account.muted}
									onClick={() => onSelectNav?.(mb.id)}
								/>
							))}
							{(hiddenCount > 0 || showAllFolders) &&
								folders.length > FOLDER_COLLAPSE_THRESHOLD && (
									<button
										type="button"
										onClick={() => setShowAllFolders((all) => !all)}
										className="ml-7 flex items-center px-2 py-1 text-2xs font-medium text-accent transition-colors hover:underline"
									>
										{showAllFolders
											? "Show less"
											: `Show all (${folders.length})`}
									</button>
								)}
						</>
					)}
				</>
			)}
		</div>
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
					<AccountNav
						key={account.id}
						account={account}
						selectedNavId={selectedNavId}
						onSelectNav={onSelectNav}
					/>
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
}: {
	thread: ThreadRowData;
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

function CompactRow({
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
			onClick={onClick}
			className={compactRowClass({ active })}
		>
			<CompactRowBody thread={thread} />
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
	return (
		<button
			type="button"
			onClick={onClick}
			className={comfortableRowClass({ active })}
		>
			<ComfortableRowBody thread={thread} />
		</button>
	);
}

/* Composable brief filters — each is an additive predicate over a thread row. */
type BriefFilterId = "unread" | "attachment" | "contacts" | "today";

/* "Today" prefers the real `sentDate` timestamp; it falls back to the fixture
   convention that same-day rows render a HH:MM timeLabel (fixtures carry no
   sentDate). */
function isTodayRow(t: ThreadRowData): boolean {
	if (t.sentDate != null) {
		return new Date(t.sentDate).toDateString() === new Date().toDateString();
	}
	return /^\d{1,2}:\d{2}$/.test(t.timeLabel);
}

const briefFilterDefs: ReadonlyArray<{
	id: BriefFilterId;
	label: string;
	match: (t: ThreadRowData) => boolean;
}> = [
	{ id: "unread", label: "Unread", match: (t) => !t.isRead },
	{
		id: "attachment",
		label: "Has attachment",
		match: (t) => !!t.hasAttachment,
	},
	{
		id: "contacts",
		label: "From contacts",
		match: (t) => t.trust === "vip" || t.trust === "wellknown",
	},
	{ id: "today", label: "Today", match: isTodayRow },
];

const LONG_SECTION = 6;
/* Cap each section's rows; the rest sit behind a bottom "Show all" expander. */
const SECTION_ROW_CAP = 10;

/** A row renderer the brief drives — Comfortable/Compact rows or a consumer's
 *  own (e.g. the web client's navigation-aware row) all satisfy this shape. */
export type BriefRowComponent = (props: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) => React.ReactNode;

export interface BriefSectionsProps {
	sections: ThreadSection[];
	briefCategory?: BriefCategoryFilter;
	selectedThreadId?: string;
	/** Source/account pills, scoping the brief to one account (single-select). */
	accountChips?: AccountChip[];
	/** Note rendered alongside the source pills (e.g. "+2 muted"). */
	mutedNote?: string;
	Row: BriefRowComponent;
	onSelectThread?: (id: string) => void;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
	onSelectAccountChip?: (id: string) => void;
}

/**
 * The daily-brief list body: category pills (single-select) + attribute chips
 * (additive) + collapsible, capped attention sections. Owns its own filter and
 * collapse state; the category axis is controlled via
 * `briefCategory`/`onSelectBriefCategory`. Consumers pre-filter `sections`
 * (e.g. by search) and pass a `Row` renderer; the web client reuses this so the
 * real brief and the Storybook prototype stay in lockstep.
 */
export function BriefSections({
	sections,
	briefCategory = "all",
	selectedThreadId,
	accountChips,
	mutedNote,
	Row,
	onSelectThread,
	onSelectBriefCategory,
	onSelectAccountChip,
}: BriefSectionsProps) {
	const [active, setActive] = useState<ReadonlySet<BriefFilterId>>(new Set());
	const [sheetExpanded, setSheetExpanded] = useState(true);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() =>
			new Set(
				sections
					.filter(
						(s) =>
							s.id === "bulk" ||
							(s.threads.length > LONG_SECTION && s.id === "rest"),
					)
					.map((s) => s.id),
			),
	);
	const [expandedSections, setExpandedSections] = useState<ReadonlySet<string>>(
		new Set(),
	);

	const toggleFilter = (id: BriefFilterId) => {
		setActive((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const toggleSection = (id: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const toggleShowAll = (id: string) => {
		setExpandedSections((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const isDesktop = useIsDesktop();

	const predicates = briefFilterDefs.filter((f) => active.has(f.id));
	const filtered = sections
		.map((section) => ({
			...section,
			threads: section.threads.filter(
				(t) =>
					(briefCategory === "all" || t.category === briefCategory) &&
					predicates.every((f) => f.match(t)),
			),
		}))
		.filter((section) => section.threads.length > 0);

	const sheetCategories: FilterSheetCategory[] = briefCategories.map((cat) => ({
		id: cat.id,
		label: cat.label,
		tone: cat.id === "all" ? "neutral" : categoryTone[cat.id],
	}));

	const sheetFilters: FilterSheetFilter[] = briefFilterDefs.map((f) => ({
		id: f.id,
		label: f.label,
	}));

	const sheetSources = accountChips?.map((chip) => ({
		id: chip.id,
		label: chip.label,
		count: chip.count,
		active: chip.active,
	}));

	const clearFilters = () => {
		onSelectBriefCategory?.("all");
		setActive(new Set());
	};

	const listBody = (
		<>
			{filtered.map((section) => {
				const isCollapsed = collapsed.has(section.id);
				const showAll = expandedSections.has(section.id);
				const capped = !showAll && section.threads.length > SECTION_ROW_CAP;
				const visible = capped
					? section.threads.slice(0, SECTION_ROW_CAP)
					: section.threads;
				const hiddenCount = section.threads.length - visible.length;
				return (
					<div key={section.id}>
						{section.label && (
							<button
								type="button"
								onClick={() => toggleSection(section.id)}
								className="sticky top-0 flex h-section-row w-full items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left transition-colors hover:bg-surface"
							>
								{isCollapsed ? (
									<ChevronRight className="size-3 shrink-0 text-fg-subtle" />
								) : (
									<ChevronDown className="size-3 shrink-0 text-fg-subtle" />
								)}
								<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
									{section.label}
								</span>
								<span className="text-2xs text-fg-subtle tabular-nums">
									{section.threads.length}
								</span>
							</button>
						)}
						{!isCollapsed && (
							<>
								<div className="divide-y divide-line">
									{visible.map((thread) => (
										<Row
											key={thread.id}
											thread={thread}
											active={thread.id === selectedThreadId}
											onClick={() => onSelectThread?.(thread.id)}
										/>
									))}
								</div>
								{section.threads.length > SECTION_ROW_CAP && (
									<button
										type="button"
										onClick={() => toggleShowAll(section.id)}
										className="flex w-full items-center justify-center border-b border-line px-row-inset py-1.5 text-2xs font-medium text-accent transition-colors hover:bg-surface"
									>
										{showAll
											? "Show less"
											: `Show all (${section.threads.length})`}
										{!showAll && hiddenCount > 0 && (
											<ChevronDown className="ml-1 size-3" />
										)}
									</button>
								)}
							</>
						)}
					</div>
				);
			})}
			{filtered.length === 0 && (
				<div className="px-row-inset py-6 text-center text-2xs text-fg-subtle">
					No threads match these filters.
				</div>
			)}
		</>
	);

	if (!isDesktop) {
		return (
			<FilterSheet
				categories={sheetCategories}
				filters={sheetFilters}
				sources={sheetSources}
				sourcesNote={mutedNote}
				selectedCategory={briefCategory}
				activeFilters={active}
				expanded={sheetExpanded}
				onExpandedChange={setSheetExpanded}
				onSelectCategory={(id) =>
					onSelectBriefCategory?.(id as BriefCategoryFilter)
				}
				onSelectSource={(id) => onSelectAccountChip?.(id)}
				onToggleFilter={(id) => toggleFilter(id as BriefFilterId)}
				onClear={clearFilters}
			>
				{listBody}
			</FilterSheet>
		);
	}

	return (
		<>
			{/* source scope — single-select account pills (the brief spans
			    accounts; this narrows it to one) */}
			{sheetSources && sheetSources.length > 1 && (
				<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1">
					{sheetSources.map((source) => (
						<button
							key={source.id}
							type="button"
							onClick={() => onSelectAccountChip?.(source.id)}
							className={cn(
								"flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
								source.active
									? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
									: "border-line text-fg-muted hover:border-line-strong",
							)}
						>
							{source.label}
							{source.count != null && source.count > 0 && (
								<span className="tabular-nums opacity-70">{source.count}</span>
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

			{/* category scope — single-select colored pills (same palette as the
			    inbox category badges); a separate axis from the attribute chips */}
			<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1.5">
				{briefCategories.map((cat) => {
					const selected = briefCategory === cat.id;
					return (
						<button
							key={cat.id}
							type="button"
							onClick={() => onSelectBriefCategory?.(cat.id)}
							className={cn(
								"shrink-0 rounded-full transition-opacity",
								selected
									? "opacity-100 ring-1 ring-accent-2"
									: "opacity-60 hover:opacity-100",
							)}
						>
							<Badge tone={cat.id === "all" ? "neutral" : categoryTone[cat.id]}>
								{cat.label}
							</Badge>
						</button>
					);
				})}
			</div>

			{/* attribute filters — neutral outline chips, composable/additive */}
			<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1">
				{briefFilterDefs.map((f) => {
					const on = active.has(f.id);
					return (
						<button
							key={f.id}
							type="button"
							onClick={() => toggleFilter(f.id)}
							className={cn(
								"shrink-0 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
								on
									? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
									: "border-line text-fg-muted hover:border-line-strong",
							)}
						>
							{f.label}
						</button>
					);
				})}
			</div>

			<div className="flex-1 overflow-y-auto">{listBody}</div>
		</>
	);
}

function MessageListPane({
	listTitle,
	listMeta,
	chips,
	mutedNote,
	sections,
	briefFilters,
	briefCategory,
	selectedThreadId,
	density = "comfortable",
	onSelectThread,
	onSelectBriefCategory,
}: Pick<
	AppShellProps,
	| "listTitle"
	| "listMeta"
	| "chips"
	| "mutedNote"
	| "sections"
	| "briefFilters"
	| "briefCategory"
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
	| "onSelectBriefCategory"
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

			{/* secondary row only for non-brief lists; the brief's account chips
			    live inside BriefSections (the filter drawer on mobile) */}
			{!briefFilters && chips && chips.length > 0 && (
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

			{briefFilters ? (
				<BriefSections
					sections={sections}
					briefCategory={briefCategory}
					selectedThreadId={selectedThreadId}
					accountChips={chips}
					mutedNote={mutedNote}
					Row={Row}
					onSelectThread={onSelectThread}
					onSelectBriefCategory={onSelectBriefCategory}
				/>
			) : (
				<div className="flex-1 overflow-y-auto">
					{sections.map((section) => (
						<div key={section.id}>
							{section.label && (
								<div className="sticky top-0 flex h-section-row items-center justify-between border-b border-line bg-surface-sunken px-row-inset">
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
			)}

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
	briefFilters,
	briefCategory,
	onSelectBriefCategory,
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
	/* Category lives here when uncontrolled so the brief and the nav expando
	   share one axis; a controlled `briefCategory`/`onSelectBriefCategory` pair
	   overrides it. */
	const [internalCategory, setInternalCategory] = useState<BriefCategoryFilter>(
		briefCategory ?? "all",
	);
	const activeCategory = briefCategory ?? internalCategory;
	const selectCategory = (category: BriefCategoryFilter) => {
		setInternalCategory(category);
		onSelectBriefCategory?.(category);
	};
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
						briefFilters={briefFilters}
						briefCategory={activeCategory}
						selectedThreadId={selectedThreadId}
						density={density}
						onSelectThread={onSelectThread}
						onSelectBriefCategory={selectCategory}
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
