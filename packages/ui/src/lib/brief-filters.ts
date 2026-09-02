/**
 * The brief's attribute chips: their ids, their labels, and what each one asks
 * of a row.
 *
 * Nothing in the kit applies these. `BriefSections` renders the rows it is
 * handed, and the host decides membership: in the app two of the four are query
 * parameters answered over the whole scope, so applying them again over the page
 * that came back is how a criterion ends up meaning "among the rows fetched so
 * far" (#312). The other two — "From contacts" reads `senderTrust`, which is
 * off-row, and "Today" is a date no listing endpoint takes — have no parameter
 * anywhere, so the host applies them with `matchesBriefFilters` before it hands
 * the rows down. One table for both, rather than one per surface (#314).
 */
import type { ThreadRowData } from "../components/app-shell-types.js";
import type { FilterSheetFilter } from "../components/filter-sheet.js";

export type BriefFilterId = "unread" | "attachment" | "contacts" | "today";

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

/**
 * The brief's attribute chips as plain `{ id, label }` — the single source the
 * `briefFilterConfig` preset reuses so the live filter row and the preset can
 * never diverge.
 */
export const briefFilterChips: FilterSheetFilter[] = briefFilterDefs.map(
	({ id, label }) => ({ id, label }),
);

/**
 * Whether an id names one of the brief's attribute chips. A consumer holding
 * one filter set across several views — the workbench shell, whose mailbox
 * sheet offers chips of its own — narrows that set to the brief's own with
 * this rather than asserting it.
 */
export function isBriefFilterId(id: string): id is BriefFilterId {
	return briefFilterDefs.some((f) => f.id === id);
}

/**
 * Whether a thread survives a set of attribute chips.
 *
 * For a host with no server behind it — the workbench prototype — that is every
 * chip. For the app it is only the chips no request carries; passing a chip the
 * request already answered narrows a page by a criterion the server applied to
 * the whole scope, and the two are not the same set.
 */
export function matchesBriefFilters(
	thread: ThreadRowData,
	activeFilters: ReadonlySet<BriefFilterId>,
): boolean {
	return briefFilterDefs.every(
		(f) => !activeFilters.has(f.id) || f.match(thread),
	);
}
