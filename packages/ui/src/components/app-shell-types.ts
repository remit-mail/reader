import {
	type ReactElement,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import type { TriageHandlers } from "../lib/keymap.js";
import type { SelectionModifiers } from "../lib/use-selection.js";
import type {
	IntelligenceData,
	SenderTrustLevel,
} from "./intelligence-panel.js";
import type { ResultCount } from "./list-result-header.js";
import type { ListState } from "./message-list-state.js";
import type { RowSettlement } from "./message-settlement.js";

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

/** Seeds the narrow touch list with a swipe-peeked row for stories / SSR, so it
 *  can render that state without a live gesture. */
export type TouchSeed = "peek-trailing" | "peek-leading";

/**
 * The list's selection, owned by whoever renders the list. The kit holds none
 * of it: a surface that offers multi-select already has the selected set, the
 * range anchor and the verbs the bar runs, and one set of rows can only ever
 * answer to one of them.
 *
 * `useSelection` is the model both the app and the kit's own stories drive this
 * from.
 */
export interface MessageListSelection {
	/** The ticked rows. */
	selectedIds: ReadonlySet<string>;
	/** Ticks or unticks one row — its checkbox, and a long press on touch. */
	onToggle: (id: string) => void;
	/**
	 * A row click and the modifiers it carried. True when selection took the
	 * click, in which case the row does not open.
	 */
	onRowSelect?: (id: string, modifiers: SelectionModifiers) => boolean;
}

/**
 * The keyboard layer above the list, owned by whoever mounts it. The handler
 * table is what the pane reads: it offers the keys that table answers, draws
 * the cursor the ones it answers move, and keeps its own arrow-key traversal
 * for the ones it does not. A layer that answers nothing offers nothing, so a
 * host cannot advertise a key it has not wired.
 *
 * `useListKeyboard` builds it; the pane hands `ref` back the element the layer
 * listens on.
 */
export interface MessageListKeyboard {
	/** The row the cursor sits on. */
	focusedId: string | undefined;
	/** What the layer answers, and therefore what the footer offers. */
	handlers: TriageHandlers;
	/** Takes the pane element the layer binds its keys to. */
	ref: (element: HTMLElement | null) => void;
}

/**
 * Whether a layer answers the cursor keys, and so walks the rows itself. A list
 * under one stands its own roving-focus group down: both own the arrows, and
 * the group stops the press before the layer above hears it.
 */
export function keyboardWalksRows(
	keyboard: MessageListKeyboard | undefined,
): keyboard is MessageListKeyboard {
	if (keyboard === undefined) return false;
	return (
		keyboard.handlers.focusNext !== undefined &&
		keyboard.handlers.focusPrevious !== undefined
	);
}

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
		// The content box, matching what the observer reports above: the shell
		// root carries the device safe-area insets as padding and the panes are
		// laid out in what is left, so the first synchronous measure and every
		// later one have to be the same box.
		const style = getComputedStyle(el);
		const horizontalPadding =
			Number.parseFloat(style.paddingLeft) +
			Number.parseFloat(style.paddingRight);
		setWidth(el.clientWidth - horizontalPadding);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}

/**
 * System-folder role for a sidebar mailbox, resolved by the web-client adapter —
 * the single detection path (see `mailbox-order.ts`). Absent = a custom user
 * folder. The kit pins, orders, and icons system folders purely by this role and
 * never inspects raw IMAP SPECIAL-USE strings itself. "inbox" is included even
 * though INBOX carries no SPECIAL-USE attribute (it is matched by name).
 */
export type NavMailboxRole =
	| "inbox"
	| "flagged"
	| "drafts"
	| "sent"
	| "archive"
	| "all"
	| "junk"
	| "trash";

export interface NavMailbox {
	id: string;
	name: string;
	unseen?: number;
	/** System-folder role (adapter-computed). Absent = a custom user folder. */
	role?: NavMailboxRole;
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
	| "uncategorized"
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
	{ id: "uncategorized", label: "Unclassified" },
	{ id: "newsletter", label: "Newsletters" },
	{ id: "marketing", label: "Marketing" },
	{ id: "automated", label: "Automated" },
	{ id: "transactional", label: "Transactional" },
	{ id: "social", label: "Social" },
];

/**
 * Whether an id names one of the brief's category scopes. A host holding one
 * category across views whose sheets speak plain strings narrows it with this
 * rather than asserting it.
 */
export function isBriefCategory(id: string): id is BriefCategoryFilter {
	return briefCategories.some((c) => c.id === id);
}

export interface ThreadRowLabel {
	labelId: string;
	name: string;
	color: string;
}

export interface ThreadRowData {
	id: string;
	/**
	 * Owning IMAP account — the `accountId` path parameter of the account API,
	 * never the caller's `accountConfigId`. Optional because rows from
	 * per-mailbox listings do not carry it; a required field forced producers to
	 * substitute the always-present `accountConfigId`, which 404s every
	 * `/accounts/{accountId}/…` call made with it.
	 */
	accountId?: string;
	/** Owning mailbox — used by the `in:` search-token filter. */
	mailboxId?: string;
	/**
	 * The conversation this row belongs to. Paired with {@link mailboxId} it is
	 * enough to open the row, which is what a row found by a cross-folder search
	 * needs: its message is not in the list the reading pane resolves against.
	 */
	threadId?: string;
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
	/** Labels applied to this message (issue #26) — filter-, organize-, and manually-applied alike. */
	labels?: ThreadRowLabel[];
	/**
	 * The row's last IMAP mutation has not settled, so what this row shows is a
	 * local write the mail server has not confirmed (issue #1002). Absent means
	 * settled — the ordinary case, and the only one with no treatment.
	 */
	settlement?: RowSettlement;
}

export interface ThreadSection {
	id: string;
	/** Section label; omit for a flat list. */
	label?: string;
	threads: ThreadRowData[];
	/**
	 * How much mail the section's category holds, as the server counted it —
	 * independent of how many rows were fetched. Absent, or `unknown`, renders no
	 * number: a loaded-row length presented as a category total is the defect this
	 * replaces (#312).
	 */
	total?: ResultCount;
	/**
	 * The section's request came back full, so the category holds more than these
	 * rows whether or not anyone counted it. It is the only thing that keeps a way
	 * out of a section whose total was withheld.
	 */
	atCap?: boolean;
	/** The section's own request is still in flight, so it has no rows yet. */
	loading?: boolean;
	/**
	 * The section's own request failed. Each section is its own query, so one
	 * category's failure states itself where that category would have been and
	 * leaves the rest of the brief standing.
	 */
	error?: boolean;
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
	 * Seed the narrow touch list with a swipe-peeked row, so a story / SSR can
	 * show that triage state statically. Only meaningful below the reading
	 * boundary; ignored once the reading pane fits or when the message view is
	 * showing.
	 */
	initialTouchState?: TouchSeed;
	/**
	 * The list header, forwarded to `MessageListPane`'s `selectionBar` slot. The
	 * caller mounts it for every state of the list: it names the view while
	 * nothing is ticked and carries the count and the verbs from the first
	 * ticked row.
	 */
	selectionBar?: ReactNode;
	/** The list's selection, forwarded to `MessageListPane`. */
	selection?: MessageListSelection;
	/** The list's keyboard layer, forwarded to `MessageListPane`. */
	keyboard?: MessageListKeyboard;
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
	uncategorized: "neutral",
	personal: "accent",
	newsletter: "neutral",
	marketing: "neutral",
	automated: "neutral",
	transactional: "positive",
	social: "warning",
};

/**
 * Whether a string names one of the classifier's categories. A host reading a
 * category off the API narrows it with this rather than asserting it: a value
 * from a newer server that this build has no tone for is a value it cannot
 * render, and it needs to know that rather than find out at lookup time.
 */
export function isThreadCategory(value: string): value is ThreadCategory {
	return Object.hasOwn(categoryTone, value);
}
