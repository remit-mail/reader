import {
	type ReactElement,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	IntelligenceData,
	SenderTrustLevel,
} from "./intelligence-panel.js";
import type { ListState } from "./message-list-state.js";

/** Pane-count thresholds, aligned to Tailwind `lg`/`xl`. The whole shell reflows
 *  by its own width: a single responsive surface, not per-device variants.
 *    < 1024px (below `lg`)          → list pane only        (phone + tablet portrait)
 *    1024–1279px (`lg`)            → list + reading pane     (two-pane)
 *    ≥ 1280px (`xl`)               → + intelligence rail     (three-pane, when present)
 */
export const READING_PANE_MIN_WIDTH = 1024;
export const INTELLIGENCE_MIN_WIDTH = 1280;

/** Which panes the shell shows at a given viewport width. Pure (no DOM) so the
 *  pane-count-by-width rule is testable. `intelligence` is gated additionally on
 *  there being intelligence data + an open thread at render time; this is the
 *  width ceiling only. */
export interface PaneLayout {
	nav: boolean;
	reading: boolean;
	intelligence: boolean;
}

/**
 * The single source of truth for the reflow rule:
 *   < readingPaneMinWidth → list alone (phone + tablet PORTRAIT) — no reading pane
 *   readingPaneMinWidth–intelligenceMinWidth → list + reading (tablet landscape / desktop)
 *   ≥ intelligenceMinWidth → + intelligence rail (widest)
 * The persistent nav pane shares the reading-pane boundary; below it the nav is
 * a slide-over, not a column.
 *
 * Both thresholds are configurable so a consumer can pass the desired pixel
 * values without forking the layout logic. The kit `AppShell` uses the
 * module-level defaults (1024 / 1280).
 */
export function resolvePaneLayout(
	width: number,
	readingPaneMinWidth = READING_PANE_MIN_WIDTH,
	intelligenceMinWidth = INTELLIGENCE_MIN_WIDTH,
): PaneLayout {
	const reading = width >= readingPaneMinWidth;
	return {
		nav: reading,
		reading,
		intelligence: width >= intelligenceMinWidth,
	};
}

export type NarrowView = "list" | "message";

/** Seeds the narrow touch list's interaction state for stories / SSR, so it can
 *  render selection mode or a swipe-peeked row without a live gesture. */
export type TouchSeed = "selection" | "peek-trailing" | "peek-leading";

/**
 * Measures an element's OWN width via ResizeObserver — a container query, not a
 * viewport one. The shell reflows by the space it actually occupies (so it works
 * embedded at any width, not just full-screen), and the pane count is derived
 * from this with `resolvePaneLayout`. Returns [ref, width]; width is `null`
 * until the first measure (SSR / pre-mount), where the shell renders list-only.
 */
export function useContainerWidth(
	seed?: number,
): [RefObject<HTMLDivElement | null>, number | null] {
	const ref = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState<number | null>(seed ?? null);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(el);
		setWidth(el.getBoundingClientRect().width);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}

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
	/**
	 * Full mailbox path, surfaced as the row's `title` tooltip so a truncated or
	 * localized leaf name still reveals where it lives. Defaults to `name`.
	 */
	fullPath?: string;
}

/** Per-account mailbox-load status, so the nav can show loading/error inline. */
export type NavAccountStatus = "loading" | "error" | "ready";

export interface NavAccount {
	id: string;
	label: string;
	email: string;
	/** Muted: excluded from unified views, still syncing. Rendered dimmed. */
	muted?: boolean;
	mailboxes: NavMailbox[];
	/**
	 * Number of outbox messages pending send. When provided, an Outbox entry
	 * appears below the system mailbox list for this account.
	 */
	outboxPending?: number;
	/**
	 * Mailbox-load status. "ready" (default) renders the mailbox list; "loading"
	 * shows a placeholder; "error" shows a retry affordance via `onRetry`.
	 */
	status?: NavAccountStatus;
	/** Retry handler for the error state. */
	onRetry?: () => void;
}

/**
 * Renders a navigation entry as a real anchor so middle-click / open-in-new-tab
 * / deep-linking / screen-reader link semantics all work. The web-client passes
 * a router `<Link>` builder; when omitted, NavItem falls back to a button with
 * programmatic `onSelectNav` (used by static stories / the AppShell preview).
 */
export interface NavLinkRenderProps {
	/** The nav id this entry targets ("brief", "outbox", or a mailbox id). */
	navId: string;
	className: string;
	ariaLabel?: string;
	title?: string;
	children: ReactNode;
	onClick?: () => void;
}

export type NavLinkComponent = (props: NavLinkRenderProps) => ReactElement;

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
	/**
	 * Seed width (px) for the container-query reflow before the first
	 * ResizeObserver measure. Lets SSR / tests render the correct pane count
	 * without a live layout pass; once mounted, the observed own-width takes over.
	 */
	initialWidth?: number;
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
	 * Flat plain-mailbox list (no section labels, no chip bar) — the shape the
	 * live `$mailboxId` MessageList renders. Defaults to the sectioned brief.
	 */
	flatList?: boolean;
	/**
	 * Drives the list pane's state. "ready" (default) renders rows; the other
	 * states render the loading skeleton / empty / error surfaces in place of
	 * the rows, mirroring the live MessageList.
	 */
	listState?: ListState;
	/** Active search query — switches the empty state to its search variant. */
	searchQuery?: string;
	/**
	 * Specific failure detail for the error state. Surfaced verbatim under the
	 * generic headline so the failure is readable (ux.md fail-loud), not a bare
	 * "something went wrong". Omit to fall back to the generic copy.
	 */
	errorMessage?: string;
	/** Retry handler for the error state. */
	onRetry?: () => void;
	/** Report handler for the error state (the failure goes somewhere). */
	onReportError?: () => void;
	/**
	 * Content-type category filter for the brief (a separate axis from the
	 * in-list chips). Selecting one narrows the brief to that category.
	 */
	briefCategory?: BriefCategoryFilter;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
	selectedThreadId?: string;
	thread?: ThreadData;
	/**
	 * Seed for the narrow single-pane view (the list, or the dedicated message
	 * view). Lets a story / SSR open straight to a thread without a click. Only
	 * meaningful below the reading boundary; ignored once the reading pane fits.
	 */
	initialNarrowView?: NarrowView;
	/**
	 * Seed the narrow touch list directly in selection mode or with a
	 * swipe-peeked row, so a story / SSR can show those triage states statically.
	 * Only meaningful below the reading boundary; ignored once the reading pane
	 * fits or when the message view is showing.
	 */
	initialTouchState?: TouchSeed;
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
