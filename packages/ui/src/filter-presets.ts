import { briefFilterChips } from "./components/brief-sections.js";
import type {
	FilterSheetCategory,
	FilterSheetFilter,
	FilterSheetSource,
} from "./components/filter-sheet.js";

/**
 * An account as a filter dimension. Accounts segment the unified daily brief
 * (the aggregate of every account); an inbox is already scoped to one account,
 * so the inbox preset never offers them.
 */
export interface FilterAccount {
	id: string;
	label: string;
	count?: number;
	active?: boolean;
}

/**
 * A FilterSheet configuration: the category, attribute, and (brief-only) account
 * groups for one view. Feed straight into `<FilterSheet {...preset} />`.
 */
export interface FilterPreset {
	categories: FilterSheetCategory[];
	filters: FilterSheetFilter[];
	sources?: FilterSheetSource[];
}

/**
 * Content-type categories, mirroring the `MessageCategory` enum
 * (@remit/remit-imap) by value. The leading "all" clears the category. Per
 * message, not per mailbox — so they apply in the brief and an inbox alike.
 */
const MESSAGE_CATEGORIES: FilterSheetCategory[] = [
	{ id: "all", label: "All", tone: "neutral" },
	{ id: "personal", label: "Personal", tone: "accent" },
	{ id: "transactional", label: "Transactional", tone: "positive" },
	{ id: "newsletter", label: "Newsletter", tone: "neutral" },
	{ id: "marketing", label: "Marketing", tone: "warning" },
	{ id: "social", label: "Social", tone: "warning" },
	{ id: "automated", label: "Automated", tone: "neutral" },
];

const UNREAD: FilterSheetFilter = { id: "unread", label: "Unread" };
// `flagged` is the wire name (IMAP \Flagged); the user-facing label is "Starred".
const FLAGGED: FilterSheetFilter = { id: "flagged", label: "Starred" };
const HAS_ATTACHMENT: FilterSheetFilter = {
	id: "attachment",
	label: "Has attachment",
};

/** Accounts become a source group only when there is more than one to pick. */
function accountSources(
	accounts: FilterAccount[],
): FilterSheetSource[] | undefined {
	if (accounts.length <= 1) return undefined;
	return accounts.map((account) => ({
		id: account.id,
		label: account.label,
		count: account.count,
		active: account.active,
	}));
}

/**
 * Daily-brief filter: categories + the BriefSections chip set (the single source
 * of truth for the brief's attribute chips), plus an account source group when
 * more than one account feeds the brief (the brief aggregates them all).
 */
export function briefFilterConfig(
	accounts: FilterAccount[] = [],
): FilterPreset {
	return {
		categories: [...MESSAGE_CATEGORIES],
		filters: briefFilterChips,
		sources: accountSources(accounts),
	};
}

/**
 * Inbox filter: categories + Unread/Flagged/Has attachment. No account group —
 * an inbox is already scoped to a single account/mailbox.
 */
export function inboxFilterConfig(): FilterPreset {
	return {
		categories: [...MESSAGE_CATEGORIES],
		filters: [UNREAD, FLAGGED, HAS_ATTACHMENT],
	};
}

/**
 * Flagged virtual-mailbox filter: categories + Unread/Has attachment. The view
 * is already scoped to starred mail, so it never offers the redundant Flagged
 * filter, and the flat starred list carries no account source group.
 */
export function flaggedFilterConfig(): FilterPreset {
	return {
		categories: [...MESSAGE_CATEGORIES],
		filters: [UNREAD, HAS_ATTACHMENT],
	};
}
