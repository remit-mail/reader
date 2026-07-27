import type {
	RemitImapMessageCategory,
	ThreadOperationsSearchThreadsData,
} from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";
import type { FilterReach } from "@remit/ui";

/** The request `threadOperationsSearchThreads` takes, whole. */
export type ThreadSearchQuery = NonNullable<
	ThreadOperationsSearchThreadsData["query"]
>;

/** The parameters the inbox chips set on that request. */
export type InboxFilterParams = Pick<
	ThreadSearchQuery,
	"category" | "unread" | "starred" | "attachments"
>;

/** The chip state the inbox holds: one category, any number of attributes. */
export interface InboxFilterCriteria {
	/** A category id, or `"all"` when the category is cleared. */
	category: string;
	attributes: ReadonlySet<string>;
}

/**
 * The search parameter each attribute chip sets. `flagged` is the wire name for
 * IMAP \Flagged, which the API calls `starred`; the label is "Starred".
 */
const ATTRIBUTE_PARAMS: Record<string, "unread" | "starred" | "attachments"> = {
	unread: "unread",
	flagged: "starred",
	attachment: "attachments",
};

const CATEGORY_VALUES = new Set<string>(Object.values(MessageCategory));

const isMessageCategory = (id: string): id is RemitImapMessageCategory =>
	CATEGORY_VALUES.has(id);

/** Whether the chips narrow the list at all — `"all"` and no attributes do not. */
export const hasInboxFilter = (criteria: InboxFilterCriteria): boolean =>
	isMessageCategory(criteria.category) || criteria.attributes.size > 0;

/**
 * The chips as search parameters, so the server returns a page of matches
 * rather than a page the browser then thins out. A category chip that names no
 * category — `"all"`, or an id the enum no longer carries — sets no parameter,
 * and `uncategorized` is a category like any other: the pending state's name,
 * never the absence of one (issue #45).
 *
 * Only the parameters a chip switches on are present, so this merges with the
 * search tokens (`is:unread`, `has:attachment`) as a union: where a chip and a
 * token set the same parameter they agree on `true`.
 */
export const inboxFilterParams = (
	criteria: InboxFilterCriteria,
): InboxFilterParams => {
	const params: InboxFilterParams = {};
	if (isMessageCategory(criteria.category)) {
		params.category = [criteria.category];
	}
	for (const id of criteria.attributes) {
		const param = ATTRIBUTE_PARAMS[id];
		if (param) params[param] = true;
	}
	return params;
};

/**
 * How much of the mailbox a request reaches, read off the request itself.
 *
 * Every criterion the inbox sends today is a column on the row, so the server
 * answers with a `where` over the whole mailbox and an empty result means the
 * folder holds no matching mail. `senderTrust` and `dkimMismatch` are resolved
 * by enriching a bounded window instead (design D7, D10), so a request carrying
 * either has only seen the pages it read. Derived rather than declared: the
 * completeness sentence the empty state renders is true of the query that was
 * issued, not of the criteria that happen to ship today.
 */
export const filterReach = (query: ThreadSearchQuery): FilterReach =>
	(query.senderTrust?.length ?? 0) > 0 || query.dkimMismatch !== undefined
		? "loaded-pages"
		: "whole-folder";

const FILTER_PARAM_NAMES = [
	"category",
	"unread",
	"starred",
	"attachments",
] as const;

const filterIdentity = (query: Record<string, unknown> | undefined): string =>
	JSON.stringify(FILTER_PARAM_NAMES.map((name) => query?.[name] ?? null));

const queryOf = (queryKey: unknown): Record<string, unknown> | undefined => {
	if (!Array.isArray(queryKey)) return undefined;
	const [entry] = queryKey;
	if (typeof entry !== "object" || entry === null) return undefined;
	const query: unknown = (entry as { query?: unknown }).query;
	if (typeof query !== "object" || query === null) return undefined;
	return query as Record<string, unknown>;
};

/**
 * Whether a cached list query was fetched under the same filter the request
 * being made now carries.
 *
 * `keepPreviousData` renders the previous key's rows while a new page is in
 * flight. That is right for a query the user is still typing and wrong the
 * moment the filter changes: the previous predicate's mail would show under the
 * new chip for one round trip, which is the failure this correction is about
 * (design D18). An unrecognized key answers `false`, so the doubtful case
 * restarts the list rather than rendering rows it cannot vouch for.
 */
export const sameInboxFilter = (
	queryKey: unknown,
	params: InboxFilterParams,
): boolean => {
	const previous = queryOf(queryKey);
	if (!previous) return false;
	return filterIdentity(previous) === filterIdentity(params);
};
