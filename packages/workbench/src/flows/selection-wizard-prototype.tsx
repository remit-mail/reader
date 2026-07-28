import {
	Badge,
	Button,
	Checkbox,
	type ClauseField,
	clauseFieldHint,
	clauseFieldLabel,
	clauseFieldOrder,
	commitLabel,
	FieldLabel,
	Input,
	MakeFilterAction,
	type MatchOperator,
	matchesBodyText,
	matchJoinWord,
	matchModeHint,
	matchModeLabel,
	matchOperatorLabel,
	PopoverMenu,
	ProgressBar,
	type RuleClause,
	type RuleMatchMode,
	type RuleScope,
	type SearchConversionNotice,
	SearchConversionNoticeView,
	Select,
	scopeLabel,
	widenChipLabel,
} from "@remit/ui";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Check,
	FolderInput,
	FolderPlus,
	Loader2,
	MailOpen,
	Plus,
	ShieldAlert,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

export interface SelectionMessage {
	id: string;
	sender: string;
	email: string;
	subject: string;
	preview: string;
	date: string;
}

export const SELECTION_SAMPLE: SelectionMessage[] = [
	{
		id: "m1",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		preview: "Your stay in Lisbon is confirmed for Jul 12–16.",
		date: "Jul 2",
	},
	{
		id: "m2",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Your reservation is confirmed – Lisbon",
		preview: "Miguel is expecting you on Friday at 15:00.",
		date: "Jun 28",
	},
	{
		id: "m3",
		sender: "Expedia",
		email: "travel@expediamail.com",
		subject: "Itinerary for your upcoming trip",
		preview: "Flight IB3109 departs Amsterdam 09:40.",
		date: "Jun 27",
	},
	{
		id: "m4",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Your ticket for Lisboa → Porto",
		preview: "Coach 4, seat 21A. Show this QR at the gate.",
		date: "Jun 24",
	},
	{
		id: "m5",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "How was your stay?",
		preview: "Leave a review and help other travellers.",
		date: "Jun 19",
	},
	{
		id: "m6",
		sender: "Ryanair",
		email: "noreply@ryanair.com",
		subject: "Check-in is now open",
		preview: "Check in before Jul 11 to avoid the airport fee.",
		date: "Jun 18",
	},
	{
		id: "m7",
		sender: "KLM",
		email: "info@klm.com",
		subject: "Your boarding pass for KL1695",
		preview: "Gate D14 closes 20 minutes before departure.",
		date: "Jun 17",
	},
	{
		id: "m8",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Your stay in Porto is 3 weeks away",
		preview: "Casa do Conto expects you on Jul 16.",
		date: "Jun 15",
	},
	{
		id: "m9",
		sender: "Rome2Rio",
		email: "hello@rome2rio.com",
		subject: "Getting from Porto airport to the centre",
		preview: "Metro line E runs every 20 minutes until 01:00.",
		date: "Jun 14",
	},
	{
		id: "m10",
		sender: "Sixt",
		email: "noreply@sixt.com",
		subject: "Rental agreement 4471-9930",
		preview: "Pick up Jul 18, 10:00, Porto Campanhã.",
		date: "Jun 11",
	},
	{
		id: "m11",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Miguel sent you a message",
		preview: "The key box code is on the door to the left.",
		date: "Jun 9",
	},
	{
		id: "m12",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Refund processed for CP 4412",
		preview: "€24.50 is back on the card ending 4417.",
		date: "Jun 6",
	},
	{
		id: "m13",
		sender: "Expedia",
		email: "travel@expediamail.com",
		subject: "Price drop on your saved trip",
		preview: "Amsterdam → Faro is now €38 lower.",
		date: "Jun 4",
	},
	{
		id: "m14",
		sender: "GetYourGuide",
		email: "noreply@getyourguide.com",
		subject: "Your Douro valley tour is booked",
		preview: "Meet at Praça da Liberdade, 08:15.",
		date: "Jun 2",
	},
	{
		id: "m15",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Free cancellation ends tomorrow",
		preview: "Hotel Bairro Alto can still be changed until Jun 1.",
		date: "May 31",
	},
	{
		id: "m16",
		sender: "Ryanair",
		email: "noreply@ryanair.com",
		subject: "Schedule change on FR2455",
		preview: "Departure moved from 06:20 to 07:05.",
		date: "May 28",
	},
	{
		id: "m17",
		sender: "Revolut",
		email: "no-reply@revolut.com",
		subject: "Travel insurance for your Portugal trip",
		preview: "Cover starts the day you leave the country.",
		date: "May 26",
	},
	{
		id: "m18",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Receipt for your Porto reservation",
		preview: "Paid €412.00 on May 24.",
		date: "May 24",
	},
	{
		id: "m19",
		sender: "Skyscanner",
		email: "alerts@skyscanner.net",
		subject: "Fare alert: Lisbon in September",
		preview: "Return flights from €96 for the dates you watched.",
		date: "May 21",
	},
	{
		id: "m20",
		sender: "KLM",
		email: "info@klm.com",
		subject: "Choose your seats for KL1694",
		preview: "Rows 12 to 18 are still open at no charge.",
		date: "May 19",
	},
];

/**
 * A page of results for the query "npm". The rows are deliberately of three
 * kinds, so the two widened doors pull apart: mail that carries the word,
 * ecosystem mail that does not (a semantic reach), and unrelated mail that a
 * literal subject clause would still miss or catch by accident.
 */
export const SELECTION_SEARCH_SAMPLE: SelectionMessage[] = [
	{
		id: "s1",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "npm: remit-ui@0.4.2 was published",
		preview: "A new version of a package you own is now on the registry.",
		date: "Jul 3",
	},
	{
		id: "s2",
		sender: "npm",
		email: "security@npmjs.com",
		subject: "npm security advisory affects 2 of your packages",
		preview: "A high-severity advisory was published for lodash.",
		date: "Jul 2",
	},
	{
		id: "s3",
		sender: "Node Weekly",
		email: "newsletter@cooperpress.com",
		subject: "Node.js 24 reaches LTS, plus 12 links",
		preview: "The release notes, the timeline, and what breaks.",
		date: "Jul 1",
	},
	{
		id: "s4",
		sender: "GitHub",
		email: "notifications@github.com",
		subject: "[remit] Dependabot: bump vite from 7.3.4 to 7.3.6",
		preview: "Automated dependency update opened a pull request.",
		date: "Jun 30",
	},
	{
		id: "s5",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "npm now requires two-factor authentication",
		preview: "Publishing without 2FA stops working on Aug 1.",
		date: "Jun 29",
	},
	{
		id: "s6",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		preview: "Your stay in Lisbon is confirmed for Jul 12–16.",
		date: "Jun 28",
	},
	{
		id: "s7",
		sender: "JavaScript Weekly",
		email: "newsletter@cooperpress.com",
		subject: "The state of bundlers in 2026",
		preview: "Rolldown lands, esbuild holds, and the numbers behind it.",
		date: "Jun 27",
	},
	{
		id: "s8",
		sender: "Eline",
		email: "eline@example.com",
		subject: "Re: can you look at the npm thing tonight?",
		preview: "It fails on my machine but not on the runner.",
		date: "Jun 26",
	},
	{
		id: "s9",
		sender: "Sentry",
		email: "noreply@sentry.io",
		subject: "New issue: TypeError in @remit/web-client",
		preview: "Seen 41 times in the last hour on production.",
		date: "Jun 25",
	},
	{
		id: "s10",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "Your npm access token expires in 7 days",
		preview: "Rotate it before Jul 2 to keep publishing.",
		date: "Jun 22",
	},
	{
		id: "s11",
		sender: "LinkedIn",
		email: "jobs@linkedin.com",
		subject: "5 new Node.js roles near Amsterdam",
		preview: "Based on the skills on your profile.",
		date: "Jun 21",
	},
	{
		id: "s12",
		sender: "ABN AMRO",
		email: "noreply@abnamro.nl",
		subject: "Betaalbevestiging €218,00",
		preview: "Uw betaling is geslaagd op 20 juni 2026.",
		date: "Jun 20",
	},
];

/**
 * Three receipts from three different senders whose subjects share a run of
 * words. Senders that neither repeat nor share a domain are what pushes the
 * property prefill off the sender and onto the shared subject fragment.
 */
export const SELECTION_RECEIPTS_SAMPLE: SelectionMessage[] = [
	{
		id: "r1",
		sender: "Blue Bottle",
		email: "receipts@bluebottle.example",
		subject: "Your receipt from Blue Bottle #4821",
		preview: "Two bags of Bella Donovan, picked up in store.",
		date: "Jul 1",
	},
	{
		id: "r2",
		sender: "Ritual Coffee",
		email: "hello@ritual.example",
		subject: "Re: Your receipt from Ritual Coffee #119",
		preview: "Thanks for coming in — here is the copy you asked for.",
		date: "Jun 30",
	},
	{
		id: "r3",
		sender: "Sightglass",
		email: "no-reply@sightglass.example",
		subject: "Your receipt from Sightglass #77",
		preview: "Owl's Howl espresso, 1kg. Paid by card.",
		date: "Jun 28",
	},
	{
		id: "r4",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Your ticket for Lisboa → Porto",
		preview: "Coach 4, seat 21A. Show this QR at the gate.",
		date: "Jun 24",
	},
];

export const FOLDERS = [
	"Archive",
	"Travel",
	"Travel/2026",
	"Receipts",
	"Newsletters",
	"Work",
	"Personal",
	"Junk",
];

export type Verb = "delete" | "move" | "junk" | "markRead" | "organize";

/**
 * What the action is applied to. The two widened doors are the shipped
 * `RuleMatchMode` values; `selected` is not one of them, and is not a rule match
 * mode at all — it is the bounded list of ticked message ids, which no predicate
 * stands in for. Neither widened door carries a count until it has run.
 */
export type MatchMode = "selected" | RuleMatchMode;

/* ------------------------------------------------------------------ */
/* Property clauses                                                    */
/* ------------------------------------------------------------------ */

/**
 * A clause is a field and a value. There is no per-clause operator in the
 * shipped rule — `From`, `Subject` and `HasWords` match on containment, and
 * `ListId` and `FromDomain` carry their own comparison in the field itself.
 * `MatchOperator` is how the clauses combine, not how one of them compares.
 */
export const clauseWords = (clause: RuleClause): string =>
	`${clauseFieldLabel(clause.field)} "${clause.value}"`;

export const clauseSentence = (
	clauses: RuleClause[],
	operator: MatchOperator,
): string => clauses.map(clauseWords).join(` ${matchJoinWord(operator)} `);

/* ------------------------------------------------------------------ */
/* Sender and subject derivation                                       */
/* ------------------------------------------------------------------ */

/**
 * Distinct sender addresses, trimmed, empties dropped, de-duplicated
 * case-insensitively while preserving first-seen casing and order.
 */
export const distinctSenders = (senders: readonly string[]): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of senders) {
		const value = raw.trim();
		if (value === "") continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
};

/**
 * The registrable domain behind a sender address. The shipped derivation is
 * public-suffix aware (tldts `getDomain`); this trailing-two-labels stand-in is
 * the same string for every fixture here but not for a multi-part suffix.
 */
export const senderDomain = (address: string): string | null => {
	const at = address.lastIndexOf("@");
	const host = (at >= 0 ? address.slice(at + 1) : address).trim();
	if (host === "") return null;
	const labels = host.split(".");
	if (labels.length < 2) return null;
	return labels.slice(-2).join(".");
};

/**
 * The single registrable domain the whole selection collapses to, or `null` when
 * it does not. A collapse needs at least two distinct senders that all resolve to
 * one domain — the "anyone at this domain" signal. One sender stays a precise
 * `From` clause rather than widening a single address to its whole domain.
 */
export const collapsibleDomain = (
	senders: readonly string[],
): string | null => {
	const distinct = distinctSenders(senders);
	if (distinct.length < 2) return null;
	let shared: string | null = null;
	for (const sender of distinct) {
		const domain = senderDomain(sender);
		if (domain === null) return null;
		if (shared === null) shared = domain;
		else if (shared !== domain) return null;
	}
	return shared;
};

/** Reply, forward, and list-tag decorations that carry no meaning for a match. */
const SUBJECT_PREFIX =
	/^\s*(?:(?:re|aw|fwd?|vs|sv|antw|res|enc|tr)\s*(?:\[\d+\])?\s*:|\[[^\]]{1,32}\])\s*/i;

export const normalizeSubject = (subject: string): string => {
	let value = subject.replace(/\s+/g, " ").trim();
	for (;;) {
		const stripped = value.replace(SUBJECT_PREFIX, "");
		if (stripped === value) return value.trim();
		value = stripped;
	}
};

/** Words too common to be a rule on their own. */
const WEAK_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"have",
	"in",
	"is",
	"it",
	"me",
	"my",
	"new",
	"of",
	"on",
	"or",
	"our",
	"the",
	"this",
	"to",
	"was",
	"we",
	"with",
	"you",
	"your",
]);

const MIN_FRAGMENT_LENGTH = 3;

const subjectWords = (subject: string): string[] =>
	subject.split(" ").filter((word) => word !== "");

const isUsefulFragment = (fragment: string[]): boolean => {
	if (fragment.length === 0) return false;
	if (fragment.join(" ").length < MIN_FRAGMENT_LENGTH) return false;
	return fragment.some((word) => !WEAK_WORDS.has(word.toLowerCase()));
};

const runAt = (haystack: string[], needle: string[]): number =>
	haystack.findIndex((_, start) =>
		needle.every(
			(word, offset) =>
				haystack[start + offset]?.toLowerCase() === word.toLowerCase(),
		),
	);

/**
 * The longest run of whole words every subject carries, in the casing the first
 * subject uses. `undefined` when they share nothing worth matching on.
 */
export const sharedSubjectFragment = (
	subjects: readonly string[],
): string | undefined => {
	const normalized = subjects
		.map(normalizeSubject)
		.filter((subject) => subject !== "");
	if (normalized.length === 0) return undefined;
	const [first, ...rest] = normalized;
	if (rest.length === 0) {
		return isUsefulFragment(subjectWords(first)) ? first : undefined;
	}

	const firstWords = subjectWords(first);
	for (let length = firstWords.length; length > 0; length -= 1) {
		for (let start = 0; start + length <= firstWords.length; start += 1) {
			const candidate = firstWords.slice(start, start + length);
			if (!isUsefulFragment(candidate)) continue;
			if (
				rest.every((subject) => runAt(subjectWords(subject), candidate) >= 0)
			) {
				return candidate.join(" ");
			}
		}
	}
	return undefined;
};

/**
 * Whether a selection's senders are matched as addresses or as the one domain
 * they share. Only offered when they collapse; it is a real user decision, not a
 * derivation the wizard can settle on its own.
 */
export type SenderMatch = "address" | "domain";

export const deriveSenderClauses = (
	senders: readonly string[],
	senderMatch: SenderMatch,
): RuleClause[] => {
	const domain = collapsibleDomain(senders);
	if (domain !== null && senderMatch === "domain") {
		return [
			{ id: "seed-domain", field: "FromDomain", value: domain, derived: true },
		];
	}
	return distinctSenders(senders).map((value, index) => ({
		id: `seed-from-${index}`,
		field: "From",
		value,
		derived: true,
	}));
};

/**
 * The clauses the property editor opens on. The ticked messages are the only
 * evidence: one sender, or several on one domain, is sharper than any subject
 * fragment; mixed senders fall back to the part their subjects share; neither
 * leaves the editor empty rather than guessing.
 */
export const seedClauses = (
	messages: readonly SelectionMessage[],
	senderMatch: SenderMatch,
): RuleClause[] => {
	const senders = messages.map((message) => message.email);
	const senderClauses = deriveSenderClauses(senders, senderMatch);
	if (senderClauses.length <= 1) return senderClauses;

	const fragment = sharedSubjectFragment(messages.map((m) => m.subject));
	if (fragment !== undefined) {
		return [{ id: "seed", field: "Subject", value: fragment, derived: true }];
	}
	return senderClauses;
};

/**
 * The widened-by-reading door. It rides on the messages that were ticked, never
 * on the search text — free text has no message to anchor a similarity on, which
 * is why a search-derived rule carries no widen at all.
 */
export const similarLabel = (anchorCount: number): string =>
	widenChipLabel({ anchorCount });

/* ------------------------------------------------------------------ */
/* Search conversion — the second way in                               */
/* ------------------------------------------------------------------ */

/**
 * A stand-in for the shipped token parser and search-to-rule conversion
 * (`lib/search-tokens.ts` and `lib/organize/search-to-rule.ts` in
 * `packages/web-client`), which workbench cannot import. Same vocabulary and the
 * same honesty about what a filter cannot carry — a folder scope, the attribute
 * facets, and the semantic reach literal words lose — so the notice this feeds is
 * the shipped one, not a second wording of it.
 */
export type SearchFacetType =
	| "from"
	| "subject"
	| "in"
	| "hasAttachment"
	| "isUnread"
	| "isRead"
	| "isStarred"
	| "before"
	| "after";

export interface SearchFacet {
	type: SearchFacetType;
	value: string;
}

export interface ParsedQuery {
	/** The query with every recognized facet removed, whitespace collapsed. */
	freeText: string;
	facets: SearchFacet[];
}

const FACET_PATTERN = /(from|subject|in|is|has|before|after):("[^"]*"|\S+)/gi;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const unquote = (value: string): string =>
	value.startsWith('"') ? value.slice(1, -1) : value;

/** A `word:value` pair, or `undefined` when the value is not one this token takes. */
const toFacet = (name: string, value: string): SearchFacet | undefined => {
	if (value === "") return undefined;
	if (name === "from") return { type: "from", value };
	if (name === "subject") return { type: "subject", value };
	if (name === "in") return { type: "in", value };
	if (name === "is") {
		if (value === "unread") return { type: "isUnread", value };
		if (value === "read") return { type: "isRead", value };
		if (value === "starred") return { type: "isStarred", value };
		return undefined;
	}
	if (name === "has") {
		if (value === "attachment") return { type: "hasAttachment", value };
		return undefined;
	}
	if (!DATE_PATTERN.test(value)) return undefined;
	return { type: name === "before" ? "before" : "after", value };
};

/** An unrecognized `word:value` stays free text rather than becoming a facet. */
export const parseSearchQuery = (query: string): ParsedQuery => {
	const facets: SearchFacet[] = [];
	let text = query;
	for (const match of query.matchAll(FACET_PATTERN)) {
		const facet = toFacet(match[1].toLowerCase(), unquote(match[2]));
		if (facet === undefined) continue;
		facets.push(facet);
		text = text.replace(match[0], " ");
	}
	return { freeText: text.replace(/\s+/g, " ").trim(), facets };
};

const FACET_HAS_NO_CLAUSE: ReadonlySet<SearchFacetType> = new Set([
	"hasAttachment",
	"isUnread",
	"isRead",
	"isStarred",
	"before",
	"after",
]);

const facetLabel = (facet: SearchFacet): string => {
	if (facet.type === "hasAttachment") return "Has attachment";
	if (facet.type === "isUnread") return "Unread";
	if (facet.type === "isRead") return "Read";
	if (facet.type === "isStarred") return "Starred";
	if (facet.type === "before") return `Before ${facet.value}`;
	return `After ${facet.value}`;
};

export interface SearchConversion {
	clauses: RuleClause[];
	matchOperator: MatchOperator;
	notice: SearchConversionNotice;
}

/**
 * The rule a query converts to. Terms become a `HasWords` clause, `from:` and
 * `subject:` their own clauses, and everything the clauses cannot express is
 * reported rather than folded in. The rule carries no widen: free text has no
 * message to anchor a similarity on.
 */
export const convertSearchToRule = (
	query: string,
	{ searchHadSemanticReach }: { searchHadSemanticReach: boolean },
): SearchConversion => {
	const { freeText, facets } = parseSearchQuery(query);
	const clauses: RuleClause[] = [];
	const droppedFacets: string[] = [];
	let scopedOutFolder: string | undefined;

	for (const facet of facets) {
		if (facet.type === "from" || facet.type === "subject") {
			clauses.push({
				id: `search-${clauses.length}`,
				field: facet.type === "from" ? "From" : "Subject",
				value: facet.value,
			});
			continue;
		}
		if (facet.type === "in") {
			scopedOutFolder = facet.value;
			continue;
		}
		if (FACET_HAS_NO_CLAUSE.has(facet.type)) {
			droppedFacets.push(facetLabel(facet));
		}
	}

	const keptTerms = freeText !== "";
	if (keptTerms) {
		clauses.push({
			id: `search-${clauses.length}`,
			field: "HasWords",
			value: freeText,
		});
	}

	return {
		clauses,
		matchOperator: "all",
		notice: {
			scopedOutFolder,
			droppedFacets,
			droppedSemantic: keptTerms && searchHadSemanticReach,
		},
	};
};

/**
 * Whether the conversion yields a rule with something to match. A query of only
 * dropped facets, or a bare folder scope, converts to nothing — the affordance
 * says so rather than opening an empty editor.
 */
export const isConvertible = (conversion: SearchConversion): boolean =>
	conversion.clauses.length > 0;

/**
 * Taking "Make this a filter" above a page of results. The query is the anchor
 * here, and it is the only place a query is: the wizard opens on the property
 * step with the converted clauses, needs nothing ticked, and offers no widen.
 */
export interface SearchEntry {
	conversion: SearchConversion;
	/** The rows the query already surfaced — what the rule is judged against. */
	results: SelectionMessage[];
}

/* ------------------------------------------------------------------ */
/* Folder paths                                                        */
/* ------------------------------------------------------------------ */

export const folderParent = (path: string): string => {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
};

export const folderLeaf = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);

export const folderDepth = (path: string): number => path.split("/").length - 1;

/**
 * Puts every child straight after its parent so the list reads as a tree, while
 * leaving the order of unrelated folders alone. A folder whose parent is missing
 * from the list renders as a root rather than disappearing.
 */
export const orderFolders = (paths: string[]): string[] => {
	const emitted = new Set<string>();
	const out: string[] = [];

	const emit = (path: string) => {
		if (emitted.has(path)) return;
		emitted.add(path);
		out.push(path);
		for (const candidate of paths) {
			if (folderParent(candidate) === path) emit(candidate);
		}
	};

	for (const path of paths) {
		const parent = folderParent(path);
		if (parent && paths.includes(parent)) continue;
		emit(path);
	}
	return out;
};

/* ------------------------------------------------------------------ */
/* Rule naming                                                         */
/* ------------------------------------------------------------------ */

export const dominantSender = (
	messages: SelectionMessage[],
): string | undefined => {
	const counts = new Map<string, number>();
	for (const message of messages) {
		counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 0;
	for (const [sender, count] of counts) {
		if (count <= bestCount) continue;
		best = sender;
		bestCount = count;
	}
	return best;
};

export interface RuleNameParts {
	/** What a property match is anchored on — the leading clause value. */
	match?: string;
	/** The sender carrying most of the ticked rows. */
	sender?: string;
	/** The destination, once one has been chosen. */
	folder?: string;
}

/** The name the wizard can infer from what it already knows. */
export const suggestRuleName = ({
	match,
	sender,
	folder,
}: RuleNameParts): string => {
	const subject = match ?? sender;
	if (!subject) return folder ? `Mail to ${folder}` : "";
	if (folder) return `${subject} → ${folder}`;
	if (match) return `Mail matching ${match}`;
	return `Mail from ${subject}`;
};

const VERBS: Record<
	Verb,
	{
		label: string;
		icon: ReactNode;
		destructive: boolean;
		present: string;
		past: string;
	}
> = {
	delete: {
		label: "Delete",
		icon: <Trash2 className="size-5" />,
		destructive: true,
		present: "Deleting",
		past: "Deleted",
	},
	move: {
		label: "Move",
		icon: <FolderInput className="size-5" />,
		destructive: false,
		present: "Moving",
		past: "Moved",
	},
	junk: {
		label: "Junk",
		icon: <ShieldAlert className="size-5" />,
		destructive: true,
		present: "Marking as junk",
		past: "Marked as junk",
	},
	markRead: {
		label: "Mark read",
		icon: <MailOpen className="size-5" />,
		destructive: false,
		present: "Marking read",
		past: "Marked read",
	},
	organize: {
		label: "Organize",
		icon: <Sparkles className="size-5" />,
		destructive: false,
		present: "Organizing",
		past: "Organized",
	},
};

export type StepId =
	| "match"
	| "properties"
	| "folder"
	| "rule"
	| "name"
	| "review"
	| "run";

/**
 * The step list is a function of the answers so far, not of the verb alone: the
 * property door earns an editor step and a saved rule earns a naming step.
 *
 * Both branching answers are given on a step that sits *before* the step they
 * add, and every variant keeps the steps it shares in the same position. So an
 * index taken before an answer changes still points at the step the user is
 * looking at, and the history entries the wizard owns stay equal to that index.
 *
 * Entering from a search drops the anchor step rather than opening past it: there
 * is nothing ticked to anchor on, and the query has already answered what this
 * applies to. The properties step is the first step, so the index the rail, the
 * footer and the history stack all read stays zero-based like every other entry.
 */
const stepsFor = (
	verb: Verb,
	mode: MatchMode,
	scope: RuleScope | undefined,
	fromSearch: boolean,
): StepId[] => {
	const opening: StepId[] = fromSearch
		? ["properties"]
		: mode === "properties"
			? ["match", "properties"]
			: ["match"];
	if (verb === "move") return [...opening, "folder", "review", "run"];
	if (verb === "organize") {
		if (scope === "standing" || scope === "until") {
			return [...opening, "rule", "name", "review", "run"];
		}
		return [...opening, "rule", "review", "run"];
	}
	return [...opening, "review", "run"];
};

/**
 * Where the run step lands. The job states are the ones the organize job itself
 * reports; the other three are commit outcomes that never reach a job — a filter
 * saved with nothing to back-apply, a back-apply whose request never started, and
 * a create that failed outright.
 */
export type RunState =
	| "saving"
	| "backApplyRunning"
	| "backApplyComplete"
	| "backApplyFailed"
	| "backApplyStartFailed"
	| "filterSaved"
	| "commitFailed";

const JOB_STATES: RunState[] = [
	"backApplyRunning",
	"backApplyComplete",
	"backApplyFailed",
];

/**
 * Why a sample has no rows (#452). An empty sample with no explanation reads as
 * "this rule matches nothing", which is the wrong conclusion whenever the mail
 * simply is not indexed yet.
 */
export type SampleEmptyReason = "noMatch" | "notIndexed";

const SAMPLE_EMPTY_WORDS: Record<SampleEmptyReason, string> = {
	noMatch:
		"Nothing matches this yet. Widen a property, or match on a different one.",
	notIndexed:
		"This mail isn't indexed yet, so nothing can be counted. The rule still matches once indexing catches up.",
};

const STEP_LABEL: Record<StepId, string> = {
	match: "Apply to",
	properties: "Properties",
	folder: "Folder",
	rule: "Rule",
	name: "Name",
	review: "Review",
	run: "Run",
};

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function StepRail({ steps, active }: { steps: StepId[]; active: number }) {
	return (
		<ol className="flex items-center gap-1.5" aria-label="Progress">
			{steps.map((id, i) => {
				const done = i < active;
				const current = i === active;
				return (
					<li key={id} className="flex flex-1 items-center gap-1.5">
						<span
							className={[
								"h-1 flex-1 rounded-full transition-colors",
								done || current ? "bg-accent" : "bg-surface-sunken",
							].join(" ")}
							aria-current={current ? "step" : undefined}
						/>
					</li>
				);
			})}
		</ol>
	);
}

/**
 * The full-screen wizard chrome: a fixed header carrying back and exit, the
 * step rail, one scrolling body, and a fixed footer in the thumb zone. The body
 * is the only scrolling region, so back/forward never leave the screen.
 */
function WizardScreen({
	title,
	subtitle,
	steps,
	active,
	onBack,
	onExit,
	footer,
	children,
}: {
	title: string;
	subtitle?: string;
	steps: StepId[];
	active: number;
	onBack: () => void;
	onExit: () => void;
	footer: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="fixed inset-0 z-50 flex flex-col font-sans text-fg md:items-center md:justify-center md:bg-black/40 md:p-6">
			<div className="flex min-h-0 w-full flex-1 flex-col bg-canvas md:h-[45rem] md:max-h-[calc(100dvh-3rem)] md:w-[35rem] md:max-w-[calc(100vw-3rem)] md:flex-none md:overflow-hidden md:rounded-xl md:border md:border-line md:shadow-lg">
				<header className="shrink-0 border-b border-line px-3 pb-2 pt-3">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={onBack}
							aria-label="Back"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<ArrowLeft className="size-5" />
						</button>
						<div className="min-w-0 flex-1 text-center">
							<h1 className="truncate text-sm font-semibold">{title}</h1>
							{subtitle && (
								<p className="truncate text-2xs text-fg-muted">{subtitle}</p>
							)}
						</div>
						<button
							type="button"
							onClick={onExit}
							aria-label="Cancel"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<X className="size-5" />
						</button>
					</div>
					<div className="space-y-1 px-1 pt-2">
						<StepRail steps={steps} active={active} />
						<p className="text-2xs text-fg-subtle">
							Step {active + 1} of {steps.length} · {STEP_LABEL[steps[active]]}
						</p>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
					{children}
				</div>

				<footer className="shrink-0 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
					{footer}
				</footer>
			</div>
		</div>
	);
}

/**
 * Per the never-disable tenet an unavailable choice stays pressable and dimmed:
 * pressing it says what is unavailable and takes the user somewhere that works,
 * the way a "soon" connector tile does.
 */
function ChoiceCard({
	selected,
	title,
	description,
	unavailable,
	onSelect,
	children,
}: {
	selected: boolean;
	title: ReactNode;
	description: ReactNode;
	unavailable?: boolean;
	onSelect: () => void;
	children?: ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<button
				type="button"
				onClick={onSelect}
				aria-pressed={selected}
				aria-disabled={unavailable || undefined}
				className={[
					"flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
					selected
						? "border-accent bg-accent-soft"
						: "border-line bg-surface hover:bg-surface-sunken",
					unavailable ? "opacity-55" : "",
				].join(" ")}
			>
				<span
					className={[
						"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
						selected ? "border-accent bg-accent text-accent-fg" : "border-line",
					].join(" ")}
				>
					{selected && <Check className="size-3" />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium text-fg">{title}</span>
					<span className="mt-0.5 block text-xs text-fg-muted">
						{description}
					</span>
				</span>
			</button>
			{children}
		</div>
	);
}

/**
 * The members of the match, closing every screen that names one. Naming a match
 * without showing its members is what makes an unseen bulk action impossible to
 * check, so the rows scroll in their own bounded region rather than truncating,
 * with the label and the remainder line pinned outside it.
 */
function SelectionSample({
	messages,
	total,
	label,
	emptyReason,
}: {
	messages: SelectionMessage[];
	total?: number;
	label: string;
	/** Why the sample is empty. Required whenever there are no rows to show. */
	emptyReason?: SampleEmptyReason;
}) {
	if (messages.length === 0) {
		return (
			<section className="flex flex-col rounded-lg border border-line bg-surface">
				<h2 className="shrink-0 border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
					{label}
				</h2>
				<p className="px-3 py-4 text-xs text-fg-muted">
					{SAMPLE_EMPTY_WORDS[emptyReason ?? "noMatch"]}
				</p>
			</section>
		);
	}

	return (
		<section className="flex flex-col rounded-lg border border-line bg-surface">
			<h2 className="shrink-0 border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
				{label}
			</h2>
			<ul className="min-h-0 max-h-[45dvh] divide-y divide-line overflow-y-auto overscroll-contain md:max-h-[17rem]">
				{messages.map((m) => (
					<li key={m.id} className="px-3 py-2">
						<div className="flex items-baseline justify-between gap-2">
							<span className="truncate text-xs font-medium text-fg">
								{m.sender}
							</span>
							<span className="shrink-0 text-2xs text-fg-subtle">{m.date}</span>
						</div>
						<p className="truncate text-xs text-fg-muted">{m.subject}</p>
					</li>
				))}
			</ul>
			{total !== undefined && total > messages.length && (
				<p className="shrink-0 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
					and {total - messages.length} more
				</p>
			)}
			{total === undefined && (
				<p className="shrink-0 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
					The first matches. The total is not known until the run finishes.
				</p>
			)}
		</section>
	);
}

/**
 * Per the never-disable tenet a Continue with an answer still missing stays
 * pressable and dimmed: pressing it says what is missing instead of going dead.
 */
function FooterNav({
	backLabel = "Back",
	onBack,
	nextLabel,
	onNext,
	nextVariant = "primary",
	nextBlocked,
	hint,
}: {
	backLabel?: string;
	onBack: () => void;
	nextLabel: string;
	onNext?: () => void;
	nextVariant?: "primary" | "danger";
	nextBlocked?: boolean;
	hint?: string;
}) {
	return (
		<div className="space-y-2">
			{hint && (
				<p role="status" className="px-1 text-2xs text-warning">
					{hint}
				</p>
			)}
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="touch"
					onClick={onBack}
					icon={<ArrowLeft className="size-4" />}
					className="shrink-0"
				>
					{backLabel}
				</Button>
				<Button
					variant={nextVariant}
					size="touch"
					onClick={onNext}
					aria-disabled={nextBlocked || undefined}
					className={["flex-1", nextBlocked ? "opacity-55" : ""].join(" ")}
				>
					{nextLabel}
					{nextVariant === "primary" && <ArrowRight className="size-4" />}
				</Button>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* The action bar — the list header, in its selecting state            */
/* ------------------------------------------------------------------ */

/** The verbs that earn a glyph in the bar. The rest go to the kebab. */
const BAR_VERBS: Verb[] = ["delete", "move", "organize"];
const OVERFLOW_VERBS: Verb[] = ["junk", "markRead"];

/** Words, not a bare box: a tick with no legend never says what "all" covers. */
function SelectAllToggle({
	allSelected,
	indeterminate,
	onToggle,
	className,
}: {
	allSelected: boolean;
	indeterminate: boolean;
	onToggle: () => void;
	className: string;
}) {
	return (
		<Checkbox
			className={className}
			checked={allSelected}
			indeterminate={indeterminate}
			onChange={onToggle}
			label={
				<span className="font-medium text-accent">
					{allSelected ? "Deselect all" : "Select all"}
				</span>
			}
		/>
	);
}

/**
 * The list header and the selection action bar are one surface, not two. With
 * nothing selected it names the mailbox; from the first ticked row it carries
 * the count and the verbs, replacing the title in place rather than rising from
 * the bottom of the screen.
 *
 * Select-all is permanent from 768px up, where the bar always exists and row
 * one has the room to carry it inline. On a phone it takes a second row of its
 * own while selecting, so row one stays a count and a row of verbs.
 */
export function ListActionBar({
	title,
	count,
	allSelected,
	onToggleAll,
	onExit,
	onVerb,
}: {
	title: string;
	count: number;
	allSelected: boolean;
	onToggleAll: () => void;
	onExit: () => void;
	onVerb: (verb: Verb) => void;
}) {
	const selecting = count > 0;

	return (
		<div className="shrink-0 border-b border-line bg-surface">
			<div className="flex h-14 items-center gap-1 px-2">
				{selecting && (
					<button
						type="button"
						onClick={onExit}
						aria-label="Exit selection"
						className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted md:hidden"
					>
						<ArrowLeft className="size-5" />
					</button>
				)}

				<SelectAllToggle
					allSelected={allSelected}
					indeterminate={selecting && !allSelected}
					onToggle={onToggleAll}
					className="hidden shrink-0 pl-1 pr-2 md:flex"
				/>

				<span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
					{selecting ? (
						<>
							<span className="tabular-nums">{count}</span>
							<span className="font-normal text-fg-muted"> selected</span>
						</>
					) : (
						title
					)}
				</span>

				{selecting && (
					<>
						{BAR_VERBS.map((verb) => (
							<button
								key={verb}
								type="button"
								onClick={() => onVerb(verb)}
								aria-label={VERBS[verb].label}
								title={VERBS[verb].label}
								className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken"
							>
								{VERBS[verb].icon}
							</button>
						))}
						<PopoverMenu
							triggerLabel="More actions"
							items={OVERFLOW_VERBS.map((verb) => ({
								key: verb,
								label: VERBS[verb].label,
								icon: VERBS[verb].icon,
								onSelect: () => onVerb(verb),
							}))}
						/>
					</>
				)}
			</div>

			{selecting && (
				<SelectAllToggle
					allSelected={allSelected}
					indeterminate={!allSelected}
					onToggle={onToggleAll}
					className="w-full px-3 pb-2 md:hidden"
				/>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* The property editor — the whole of its step                         */
/* ------------------------------------------------------------------ */

const CLAUSE_PLACEHOLDER: Record<ClauseField, string> = {
	From: "noreply@booking.com",
	Subject: "Booking confirmation",
	HasWords: "boarding pass",
	ListId: "python-dev.python.org",
	FromDomain: "booking.com",
};

function ClauseRow({
	clause,
	onChange,
	onRemove,
}: {
	clause: RuleClause;
	onChange: (next: RuleClause) => void;
	onRemove: () => void;
}) {
	const label = clauseFieldLabel(clause.field);
	const hint = clauseFieldHint(clause.field);
	return (
		<div className="space-y-2 rounded-lg border border-line bg-surface p-2">
			<div className="flex items-center gap-2">
				<Select
					aria-label="Property"
					value={clause.field}
					onChange={(event) =>
						onChange({ ...clause, field: event.target.value as ClauseField })
					}
					className="h-9 min-w-0 flex-1"
				>
					{clauseFieldOrder.map((field) => (
						<option key={field} value={field}>
							{clauseFieldLabel(field)}
						</option>
					))}
				</Select>
				<Input
					aria-label={`${label} value`}
					value={clause.value}
					placeholder={CLAUSE_PLACEHOLDER[clause.field]}
					autoComplete="off"
					onChange={(event) =>
						onChange({ ...clause, value: event.target.value })
					}
					className="h-9 min-w-0 flex-1"
				/>
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove the ${label} property`}
					className="flex size-9 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg"
				>
					<X className="size-4" />
				</button>
			</div>
			{clause.derived && (
				<p className="px-1 text-2xs text-fg-subtle">
					Taken from the messages you picked. Change it or take it off.
				</p>
			)}
			{hint && <p className="px-1 text-2xs text-fg-subtle">{hint}</p>}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* The wizard                                                          */
/* ------------------------------------------------------------------ */

export interface SelectionWizardProps {
	verb: Verb;
	/** The bounded set the user ticked. */
	selected: SelectionMessage[];
	/**
	 * The wizard was entered by converting a search rather than by ticking rows.
	 * Absent for every other entry, including a selection made inside a page of
	 * results — a search is a way in, not a mode the wizard runs in.
	 */
	fromSearch?: SearchEntry;
	/** Start on a given step — for stories. */
	startAt?: StepId;
	/** Open on a given door rather than the one the list implies — for stories. */
	startMode?: MatchMode;
	/** Seed the scope, so a story can land on a step a scope earns. */
	scope?: RuleScope;
	/**
	 * Similar-mail matching cannot run right now — the embedding backend is down,
	 * or this mail is not indexed yet. A runtime state, not a property of the
	 * deployment.
	 */
	semanticUnavailable?: boolean;
	/** Open the new-folder form on the folder step — for stories. */
	creatingFolder?: boolean;
	/** Where the run step lands — for stories. */
	runState?: RunState;
	/** Render the sample with no rows, and say which of the two reasons — for stories. */
	sampleEmpty?: SampleEmptyReason;
	onExit: () => void;
}

/** Where the inline new-folder form is anchored, and the parent it will use. */
interface FolderDraft {
	/** The folder row the form opened from; "" anchors it under the New folder action. */
	anchor: string;
	/** "" means top level. */
	parent: string;
}

export function SelectionWizard({
	verb,
	selected,
	fromSearch,
	startAt,
	startMode,
	scope: seedScope,
	semanticUnavailable,
	creatingFolder,
	runState = "backApplyComplete",
	sampleEmpty,
	onExit,
}: SelectionWizardProps) {
	const senders = useMemo(
		() => selected.map((message) => message.email),
		[selected],
	);
	const domain = collapsibleDomain(senders);

	const [senderMatch, setSenderMatch] = useState<SenderMatch>(
		domain === null ? "address" : "domain",
	);
	const [mode, setMode] = useState<MatchMode>(() => {
		if (fromSearch) return "properties";
		if (startMode) return startMode;
		if (startAt === "properties") return "properties";
		return "selected";
	});
	const [clauses, setClauses] = useState<RuleClause[]>(() =>
		fromSearch
			? fromSearch.conversion.clauses
			: seedClauses(selected, domain === null ? "address" : "domain"),
	);
	const [combine, setCombine] = useState<MatchOperator>(
		fromSearch?.conversion.matchOperator ?? "all",
	);
	const [folder, setFolder] = useState<string>();
	const [scope, setScope] = useState<RuleScope | undefined>(
		seedScope ?? (startAt === "name" ? "standing" : undefined),
	);
	const [until, setUntil] = useState("");
	const [semanticNote, setSemanticNote] = useState(
		Boolean(semanticUnavailable) &&
			(startMode === "properties" || startAt === "properties"),
	);
	const [ran, setRan] = useState(startAt === "run");
	const [folders, setFolders] = useState<string[]>(FOLDERS);
	const [draft, setDraft] = useState<FolderDraft | undefined>(
		creatingFolder ? { anchor: "", parent: "" } : undefined,
	);
	const [draftName, setDraftName] = useState("");
	const [draftError, setDraftError] = useState<string>();
	const [typedName, setTypedName] = useState<string>();
	const [nudged, setNudged] = useState(false);

	const steps = useMemo(
		() => stepsFor(verb, mode, scope, fromSearch !== undefined),
		[verb, mode, scope, fromSearch],
	);

	/**
	 * The step is held by id, so an answer that grows or shrinks the list can
	 * never leave a number pointing past its end; the index is derived from the
	 * list the rail and the footer are already rendering.
	 */
	const [current, setCurrent] = useState<StepId>(
		startAt ?? (fromSearch ? "properties" : "match"),
	);
	const index = Math.max(0, steps.indexOf(current));
	const step = steps[index];

	const meta = VERBS[verb];
	const widened = mode !== "selected";
	const total = widened ? undefined : selected.length;
	const covered = fromSearch ? fromSearch.results : selected;
	const sampleMessages = sampleEmpty ? [] : covered;

	const orderedFolders = useMemo(() => orderFolders(folders), [folders]);

	const leadClauseValue = clauses[0]?.value.trim() || undefined;
	const suggestedName = suggestRuleName({
		match: mode === "properties" ? leadClauseValue : undefined,
		sender: dominantSender(selected),
		folder,
	});
	const ruleName = typedName ?? suggestedName;

	const nameFieldId = useId();
	const untilFieldId = useId();
	const draftNameId = useId();
	const draftParentId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const draftRef = useRef<HTMLInputElement>(null);
	const clauseSeq = useRef(0);

	const draftAnchor = draft?.anchor;
	useEffect(() => {
		if (draftAnchor === undefined) return;
		draftRef.current?.focus();
	}, [draftAnchor]);

	const seeded = useRef(false);
	const unwinding = useRef(false);

	/**
	 * One history entry per step reached, so hardware back pops exactly one. Back
	 * is never applied to `index` directly — the header arrow calls
	 * `history.back()` and lets the popstate listener move the step, which is what
	 * keeps the stack and the visible step from drifting apart. Closing rewinds
	 * the entries the wizard owns, and `unwinding` keeps that rewind from reading
	 * as another back.
	 *
	 * The count of owned entries stays equal to `index` even as the list changes
	 * shape, because an answer that adds or drops a step can only be given on a
	 * step every variant of the list holds at the same position, and only ever
	 * adds or drops a step after it.
	 */
	useEffect(() => {
		if (seeded.current) return;
		seeded.current = true;
		for (let i = 0; i <= index; i++) {
			window.history.pushState({ wizardStep: steps[i] }, "");
		}
	}, [index, steps]);

	const dismiss = useCallback(
		(owned: number) => {
			if (owned > 0) {
				unwinding.current = true;
				window.history.go(-owned);
			}
			onExit();
		},
		[onExit],
	);

	const closes = index === 0 || step === "run";

	useEffect(() => {
		const onPopState = () => {
			if (unwinding.current) {
				unwinding.current = false;
				return;
			}
			if (closes) {
				dismiss(index);
				return;
			}
			setNudged(false);
			setCurrent(steps[index - 1]);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [closes, index, steps, dismiss]);

	const exit = () => dismiss(index + 1);

	const back = () => {
		if (closes) {
			exit();
			return;
		}
		window.history.back();
	};

	const next = () => {
		const target = Math.min(steps.length - 1, index + 1);
		if (target === index) return;
		setNudged(false);
		window.history.pushState({ wizardStep: steps[target] }, "");
		setCurrent(steps[target]);
	};

	/**
	 * A body-text clause is only readable by the index-time matcher, so a one-time
	 * apply cannot serve it. Stated where the scope is chosen, rather than refusing
	 * the clause on the step that offered it.
	 */
	const bodyClauses = clauses.filter((clause) => matchesBodyText(clause.field));

	const missing = (): string | undefined => {
		if (step === "properties") {
			if (clauses.length === 0) return "Add a property to match on.";
			if (clauses.some((clause) => clause.value.trim() === "")) {
				return "Fill in every property, or take the empty one off.";
			}
		}
		if (step === "folder" && !folder) return "Pick a destination first.";
		if (step === "rule") {
			if (!scope) return "Choose one of the three first.";
			if (scope === "once" && bodyClauses.length > 0) {
				return "Applying once can't read message bodies. Keep doing this instead, or drop the “has the words” property.";
			}
			if (scope === "until" && !until) {
				return "Pick the date this rule should stop on.";
			}
		}
		if (step === "name" && !ruleName.trim()) {
			return "Give the rule a name so you can find it later.";
		}
		return undefined;
	};
	const blocked = missing();

	const advance = () => {
		if (blocked) {
			setNudged(true);
			if (step === "name") nameRef.current?.focus();
			return;
		}
		next();
	};

	const addClause = () => {
		clauseSeq.current += 1;
		setClauses([
			...clauses,
			{ id: `clause-${clauseSeq.current}`, field: "From", value: "" },
		]);
	};

	/**
	 * Pressing the dimmed similar door. It says what is unavailable and lands on
	 * the property door with the senders already filled in, rather than going dead.
	 */
	const fallBackToProperties = () => {
		setSemanticNote(true);
		setClauses(deriveSenderClauses(senders, senderMatch));
		setMode("properties");
	};

	const chooseSenderMatch = (choice: SenderMatch) => {
		setSenderMatch(choice);
		setClauses(deriveSenderClauses(senders, choice));
	};

	const openDraft = (anchor: string) => {
		setDraft({ anchor, parent: anchor });
		setDraftName("");
		setDraftError(undefined);
	};

	const closeDraft = () => {
		setDraft(undefined);
		setDraftName("");
		setDraftError(undefined);
	};

	const createFolder = (parent: string) => {
		const name = draftName.trim();
		if (!name) {
			setDraftError("Type a name for the folder.");
			draftRef.current?.focus();
			return;
		}
		if (name.includes("/")) {
			setDraftError("A name can't contain a slash — pick a parent instead.");
			draftRef.current?.focus();
			return;
		}
		const path = parent ? `${parent}/${name}` : name;
		if (folders.includes(path)) {
			setDraftError(`${path} already exists.`);
			draftRef.current?.focus();
			return;
		}
		setFolders([...folders, path]);
		setFolder(path);
		closeDraft();
	};

	const propertyWords = clauses.length
		? `every message where ${clauseSentence(clauses, combine)}`
		: "every message";

	const matchWords =
		mode === "selected"
			? `${selected.length} messages`
			: mode === "similar"
				? `mail ${similarLabel(selected.length).toLowerCase()}`
				: propertyWords;

	const matchSummary =
		mode === "selected"
			? `${selected.length} messages`
			: mode === "similar"
				? similarLabel(selected.length)
				: clauseSentence(clauses, combine);

	const targetWords = verb === "move" && folder ? ` to ${folder}` : "";

	if (step === "match") {
		return (
			<WizardScreen
				title={meta.label}
				subtitle="What should this apply to?"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav onBack={back} nextLabel="Continue" onNext={advance} />
				}
			>
				<div className="space-y-2">
					<ChoiceCard
						selected={mode === "selected"}
						onSelect={() => setMode("selected")}
						title={`These ${selected.length} messages`}
						description="Only the messages ticked in the list."
					/>
					<ChoiceCard
						selected={mode === "similar"}
						unavailable={semanticUnavailable}
						onSelect={
							semanticUnavailable
								? fallBackToProperties
								: () => setMode("similar")
						}
						title={similarLabel(selected.length)}
						description={matchModeHint("similar")}
					>
						{semanticNote && (
							<p role="status" className="px-1 text-2xs text-fg-subtle">
								Similar-mail matching is unavailable right now — matching on the
								senders instead.
							</p>
						)}
					</ChoiceCard>
					<ChoiceCard
						selected={mode === "properties"}
						onSelect={() => setMode("properties")}
						title={matchModeLabel("properties")}
						description={matchModeHint("properties")}
					/>
				</div>
				<div className="mt-4">
					<SelectionSample
						messages={sampleMessages}
						total={total}
						label={widened ? "First matches" : "Your selection"}
						emptyReason={sampleEmpty}
					/>
				</div>
			</WizardScreen>
		);
	}

	if (step === "properties") {
		return (
			<WizardScreen
				title="Match properties"
				subtitle="Which properties have to match?"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav
						onBack={back}
						nextLabel="Continue"
						onNext={advance}
						nextBlocked={Boolean(blocked)}
						hint={nudged ? blocked : undefined}
					/>
				}
			>
				<div className="space-y-3">
					{semanticNote && (
						<p role="status" className="px-1 text-xs text-fg-muted">
							Similar-mail matching is unavailable right now. These are the
							senders of the messages you picked.
						</p>
					)}

					{fromSearch && (
						<SearchConversionNoticeView notice={fromSearch.conversion.notice} />
					)}

					{domain !== null && (
						<div className="space-y-2 rounded-lg border border-line bg-surface p-2">
							<p className="px-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
								These senders are all at {domain}
							</p>
							<div className="flex gap-2">
								<Button
									variant={senderMatch === "domain" ? "primary" : "secondary"}
									onClick={() => chooseSenderMatch("domain")}
									className="flex-1"
								>
									Anyone at {domain}
								</Button>
								<Button
									variant={senderMatch === "address" ? "primary" : "secondary"}
									onClick={() => chooseSenderMatch("address")}
									className="flex-1"
								>
									{distinctSenders(senders).length} addresses
								</Button>
							</div>
						</div>
					)}

					{clauses.length > 1 && (
						<Select
							aria-label="How the properties combine"
							value={combine}
							onChange={(event) =>
								setCombine(event.target.value as MatchOperator)
							}
							className="h-9 w-full"
						>
							<option value="all">{matchOperatorLabel("all")}</option>
							<option value="any">{matchOperatorLabel("any")}</option>
						</Select>
					)}

					{clauses.map((clause, i) => (
						<div key={clause.id} className="space-y-3">
							{i > 0 && (
								<p className="px-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
									{matchJoinWord(combine)}
								</p>
							)}
							<ClauseRow
								clause={clause}
								onChange={(nextClause) =>
									setClauses(
										clauses.map((existing) =>
											existing.id === clause.id ? nextClause : existing,
										),
									)
								}
								onRemove={() =>
									setClauses(
										clauses.filter((existing) => existing.id !== clause.id),
									)
								}
							/>
						</div>
					))}

					<Button
						variant="secondary"
						size="touch"
						onClick={addClause}
						icon={<Plus className="size-4" />}
						className="w-full"
					>
						Add another property
					</Button>

					<p className="px-1 text-xs text-fg-muted">
						We started you off from what you were looking at. Change any of it —
						this is where the rule is decided, not the list behind it.
					</p>

					<SelectionSample
						messages={sampleMessages}
						label="What this matches"
						emptyReason={sampleEmpty}
					/>
				</div>
			</WizardScreen>
		);
	}

	if (step === "folder") {
		const draftForm = draft && (
			<div className="space-y-3 border-t border-line bg-surface-sunken px-3 py-3">
				<div>
					<FieldLabel htmlFor={draftNameId}>Folder name</FieldLabel>
					<Input
						id={draftNameId}
						ref={draftRef}
						value={draftName}
						placeholder="Hotels"
						onChange={(event) => {
							setDraftName(event.target.value);
							setDraftError(undefined);
						}}
					/>
				</div>
				<div>
					<FieldLabel htmlFor={draftParentId}>Inside</FieldLabel>
					<Select
						id={draftParentId}
						value={draft.parent}
						onChange={(event) =>
							setDraft({ anchor: draft.anchor, parent: event.target.value })
						}
					>
						<option value="">Top level</option>
						{orderedFolders.map((path) => (
							<option key={path} value={path}>
								{path}
							</option>
						))}
					</Select>
				</div>
				{draftError && <p className="text-2xs text-danger">{draftError}</p>}
				<div className="flex items-center gap-2">
					<Button variant="ghost" onClick={closeDraft} className="shrink-0">
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => createFolder(draft.parent)}
						className="flex-1"
					>
						Create folder
					</Button>
				</div>
			</div>
		);

		return (
			<WizardScreen
				title="Move to"
				subtitle="Pick a destination"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav
						onBack={back}
						nextLabel="Continue"
						onNext={advance}
						nextBlocked={Boolean(blocked)}
						hint={nudged ? blocked : undefined}
					/>
				}
			>
				<div className="overflow-hidden rounded-lg border border-line bg-surface">
					<button
						type="button"
						onClick={() => openDraft("")}
						className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm font-medium text-accent hover:bg-surface-sunken"
					>
						<FolderPlus className="size-4 shrink-0" />
						New folder
					</button>
					{draft?.anchor === "" && draftForm}
					<ul className="divide-y divide-line border-t border-line">
						{orderedFolders.map((path) => (
							<li key={path}>
								<div className="flex items-center">
									<button
										type="button"
										onClick={() => setFolder(path)}
										className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left text-sm hover:bg-surface-sunken"
									>
										{folderDepth(path) > 0 && (
											<span
												aria-hidden
												className="shrink-0"
												style={{ width: folderDepth(path) * 14 }}
											/>
										)}
										<FolderInput className="size-4 shrink-0 text-fg-subtle" />
										<span className="min-w-0 flex-1 truncate">
											{folderLeaf(path)}
										</span>
										{folder === path && (
											<Check className="size-4 text-accent" />
										)}
									</button>
									<button
										type="button"
										onClick={() => openDraft(path)}
										aria-label={`New folder inside ${path}`}
										title={`New folder inside ${path}`}
										className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg"
									>
										<FolderPlus className="size-4" />
									</button>
								</div>
								{draft?.anchor === path && draftForm}
							</li>
						))}
					</ul>
				</div>
			</WizardScreen>
		);
	}

	if (step === "rule") {
		return (
			<WizardScreen
				title="Organize"
				subtitle="How long should this hold?"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav
						onBack={back}
						nextLabel="Continue"
						onNext={advance}
						nextBlocked={Boolean(blocked)}
						hint={nudged ? blocked : undefined}
					/>
				}
			>
				<div className="space-y-2">
					<ChoiceCard
						selected={scope === "once"}
						onSelect={() => setScope("once")}
						title={scopeLabel("once")}
						description="A one-off tidy-up. Nothing changes for future mail."
					/>
					<ChoiceCard
						selected={scope === "standing"}
						onSelect={() => setScope("standing")}
						title={scopeLabel("standing")}
						description="Saves a rule and applies it to new mail as it arrives, and to the mail already in your mailbox. You'll name it next."
					/>
					<ChoiceCard
						selected={scope === "until"}
						onSelect={() => setScope("until")}
						title={scopeLabel("until")}
						description="The same rule, and it stops on a day you pick."
					>
						{scope === "until" && (
							<div className="rounded-lg border border-line bg-surface p-2">
								<FieldLabel htmlFor={untilFieldId}>Stops on</FieldLabel>
								<Input
									id={untilFieldId}
									type="date"
									value={until}
									onChange={(event) => setUntil(event.target.value)}
								/>
							</div>
						)}
					</ChoiceCard>
				</div>
			</WizardScreen>
		);
	}

	if (step === "name") {
		return (
			<WizardScreen
				title="Name the rule"
				subtitle="So you can find it later"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav
						onBack={back}
						nextLabel="Continue"
						onNext={advance}
						nextBlocked={Boolean(blocked)}
						hint={nudged ? blocked : undefined}
					/>
				}
			>
				<FieldLabel htmlFor={nameFieldId}>Rule name</FieldLabel>
				<Input
					id={nameFieldId}
					ref={nameRef}
					value={ruleName}
					placeholder="Travel confirmations"
					onChange={(event) => setTypedName(event.target.value)}
					trailing={
						ruleName ? (
							<button
								type="button"
								aria-label="Clear name"
								onClick={() => {
									setTypedName("");
									nameRef.current?.focus();
								}}
								className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-surface hover:text-fg"
							>
								<X className="size-4" />
							</button>
						) : undefined
					}
				/>
				<p className="mt-2 text-xs text-fg-muted">
					We suggested one from this selection. Clear it and write your own if
					it doesn't read right.
				</p>
			</WizardScreen>
		);
	}

	if (step === "review") {
		return (
			<WizardScreen
				title="Review"
				subtitle="Check before it runs"
				steps={steps}
				active={index}
				onBack={back}
				onExit={exit}
				footer={
					<FooterNav
						onBack={back}
						nextLabel={scope ? commitLabel(scope) : meta.label}
						nextVariant={meta.destructive ? "danger" : "primary"}
						onNext={() => {
							setRan(true);
							next();
						}}
					/>
				}
			>
				<div className="space-y-4">
					<div className="rounded-lg border border-line bg-surface p-3">
						<p className="text-sm text-fg">
							<span className="font-semibold">{meta.label}</span> {matchWords}
							{targetWords}
							{(scope === "standing" || scope === "until") && (
								<>
									{" "}
									and <span className="font-medium">save a rule</span> that
									keeps doing it
								</>
							)}
							{scope === "until" && until && ` until ${until}`}.
						</p>
						{widened && (
							<p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
								<AlertTriangle className="mt-px size-3.5 shrink-0" />
								This covers messages not shown in the list.
							</p>
						)}
					</div>

					<dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface text-xs">
						<div className="flex justify-between gap-3 px-3 py-2">
							<dt className="text-fg-muted">Action</dt>
							<dd className="font-medium">{meta.label}</dd>
						</div>
						<div className="flex justify-between gap-3 px-3 py-2">
							<dt className="shrink-0 text-fg-muted">Apply to</dt>
							<dd className="truncate font-medium">{matchSummary}</dd>
						</div>
						{folder && (
							<div className="flex justify-between gap-3 px-3 py-2">
								<dt className="text-fg-muted">Destination</dt>
								<dd className="font-medium">{folder}</dd>
							</div>
						)}
						{scope && (
							<div className="flex justify-between gap-3 px-3 py-2">
								<dt className="text-fg-muted">Scope</dt>
								<dd className="font-medium">
									{scopeLabel(scope)}
									{scope === "until" && until ? ` · ${until}` : ""}
								</dd>
							</div>
						)}
						{steps.includes("name") && (
							<div className="flex justify-between gap-3 px-3 py-2">
								<dt className="text-fg-muted">Rule name</dt>
								<dd className="truncate font-medium">{ruleName}</dd>
							</div>
						)}
					</dl>

					<SelectionSample
						messages={sampleMessages}
						total={total}
						label={widened ? "A sample of what matches" : "What this covers"}
						emptyReason={sampleEmpty}
					/>
				</div>
			</WizardScreen>
		);
	}

	/**
	 * A saved rule and a one-off run end differently: a rule keeps working on mail
	 * that has not arrived yet, and its back-apply pass over the mail already in
	 * the mailbox can fail on its own without taking the rule down with it.
	 */
	const standing = scope === "standing" || scope === "until";
	const matched = covered.length;
	const failed = runState === "backApplyFailed" ? 2 : 0;
	const applied = runState === "backApplyRunning" ? 0 : matched - failed;
	const inJob = JOB_STATES.includes(runState);
	const inFlight = runState === "saving" || runState === "backApplyRunning";

	const runTitle = (): string => {
		if (runState === "saving") return standing ? "Saving rule…" : "Applying…";
		if (runState === "backApplyRunning") {
			return standing
				? "Rule saved. Moving the mail already in your mailbox…"
				: `${meta.present} ${matched} messages…`;
		}
		if (runState === "backApplyComplete") {
			return standing ? "Rule saved and applied" : `${meta.past} ${applied}`;
		}
		if (runState === "backApplyFailed") return "Organize failed";
		if (runState === "backApplyStartFailed") return "Rule saved";
		if (runState === "filterSaved") return "Filter saved";
		return "Couldn't save the rule";
	};

	const runWords = (): string => {
		if (runState === "backApplyComplete") {
			return standing
				? `${applied} of ${matched} already in your mailbox moved. New mail follows the rule as it arrives.`
				: "Every message the match reached was covered.";
		}
		if (runState === "backApplyFailed") {
			return `${applied} of ${matched} moved · ${failed} failed. Could not reach the mail server.${standing ? " The rule itself is saved." : ""}`;
		}
		if (runState === "backApplyStartFailed") {
			return "New mail follows it automatically. Moving the mail already in your mailbox didn't run — try again?";
		}
		if (runState === "filterSaved") {
			return "You can see it, and when it expires, under Settings › Filters.";
		}
		if (runState === "commitFailed") return "Please try again.";
		return "This keeps running if you close the wizard.";
	};

	const runFooter = () => {
		if (inFlight) {
			return (
				<Button variant="ghost" size="touch" className="w-full" onClick={exit}>
					Close
				</Button>
			);
		}
		if (runState === "backApplyFailed") {
			return (
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="touch" onClick={exit}>
						Close
					</Button>
					<Button variant="primary" size="touch" className="flex-1">
						Retry {failed}
					</Button>
				</div>
			);
		}
		if (runState === "backApplyStartFailed" || runState === "commitFailed") {
			return (
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="touch" onClick={exit}>
						Not now
					</Button>
					<Button variant="primary" size="touch" className="flex-1">
						{runState === "commitFailed" ? "Try again" : "Move existing mail"}
					</Button>
				</div>
			);
		}
		return (
			<Button variant="primary" size="touch" className="w-full" onClick={exit}>
				Done
			</Button>
		);
	};

	const runIcon = () => {
		if (inFlight)
			return <Loader2 className="size-10 animate-spin text-accent" />;
		if (runState === "backApplyFailed") {
			return <AlertTriangle className="size-10 text-warning" />;
		}
		if (runState === "commitFailed") {
			return <AlertTriangle className="size-10 text-danger" />;
		}
		return (
			<span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
				<Check className="size-6" />
			</span>
		);
	};

	return (
		<WizardScreen
			title={ran && !inFlight ? "Done" : meta.label}
			steps={steps}
			active={index}
			onBack={back}
			onExit={exit}
			footer={runFooter()}
		>
			<div className="space-y-4 pt-2">
				<div className="flex flex-col items-center gap-3 py-6 text-center">
					{runIcon()}
					<p className="text-sm font-medium">{runTitle()}</p>
					<p className="max-w-xs text-xs text-fg-muted">{runWords()}</p>
				</div>

				{inJob && (
					<ProgressBar
						value={applied}
						max={matched}
						tone={failed > 0 ? "warning" : "success"}
					/>
				)}

				{failed > 0 && (
					<section className="rounded-lg border border-line bg-surface">
						<h2 className="border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
							Not {meta.past.toLowerCase()}
						</h2>
						<ul className="divide-y divide-line">
							{covered.slice(0, failed).map((m) => (
								<li key={m.id} className="px-3 py-2">
									<p className="truncate text-xs font-medium">{m.sender}</p>
									<p className="truncate text-xs text-fg-muted">{m.subject}</p>
									<Badge className="mt-1" tone="warning">
										Server rejected
									</Badge>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
		</WizardScreen>
	);
}

/* ------------------------------------------------------------------ */
/* Interactive: list → bar → wizard                                    */
/* ------------------------------------------------------------------ */

/** The wizard as a story opens it: a verb, and optionally a step to land on. */
export interface WizardEntry {
	verb: Verb;
	/** Enter by converting the query rather than by ticking rows. */
	fromSearch?: boolean;
	startAt?: StepId;
	startMode?: MatchMode;
	scope?: RuleScope;
	semanticUnavailable?: boolean;
	creatingFolder?: boolean;
	runState?: RunState;
	sampleEmpty?: SampleEmptyReason;
}

export function SelectionFlow({
	messages = SELECTION_SAMPLE,
	title = "Inbox",
	query,
	searchHadSemanticReach = false,
	preselected = 0,
	preselectedIds,
	openAt,
	backdrop,
}: {
	messages?: SelectionMessage[];
	title?: string;
	/**
	 * The query this page of results is for. It puts "Make this a filter" above
	 * the list — a second way in, taken or declined. Ticking rows here reaches the
	 * same wizard as ticking rows in the inbox.
	 */
	query?: string;
	/** The search surfaced similar mail by meaning — reach the converted filter cannot carry. */
	searchHadSemanticReach?: boolean;
	/** Tick the first N rows on mount — for stories that open the wizard directly. */
	preselected?: number;
	/** Tick named rows on mount, where which rows they are is the point — for stories. */
	preselectedIds?: string[];
	/** Open the wizard on mount, on a given step — for stories. */
	openAt?: WizardEntry;
	/**
	 * The screen the wizard is judged against. The single-column list is the
	 * phone's; a desktop story hands the whole mail shell instead, because a modal
	 * over one narrow column is not the room a desktop window has.
	 */
	backdrop?: ReactNode;
}) {
	const [ids, setIds] = useState<string[]>(
		() => preselectedIds ?? messages.slice(0, preselected).map((m) => m.id),
	);
	const [entry, setEntry] = useState<WizardEntry | undefined>(openAt);

	const selected = messages.filter((m) => ids.includes(m.id));
	const toggle = (id: string) =>
		setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

	const conversion = useMemo(
		() =>
			query === undefined
				? undefined
				: convertSearchToRule(query, { searchHadSemanticReach }),
		[query, searchHadSemanticReach],
	);

	const wizard = entry && (
		<SelectionWizard
			verb={entry.verb}
			selected={selected}
			fromSearch={
				entry.fromSearch && conversion
					? { conversion, results: messages }
					: undefined
			}
			startAt={entry.startAt}
			startMode={entry.startMode}
			scope={entry.scope}
			semanticUnavailable={entry.semanticUnavailable}
			creatingFolder={entry.creatingFolder}
			runState={entry.runState}
			sampleEmpty={entry.sampleEmpty}
			onExit={() => setEntry(undefined)}
		/>
	);

	if (backdrop) {
		return (
			<div className="relative h-full w-full overflow-hidden font-sans">
				{backdrop}
				{wizard}
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-surface font-sans">
			<ListActionBar
				title={title}
				count={ids.length}
				allSelected={ids.length === messages.length}
				onToggleAll={() =>
					setIds(
						ids.length === messages.length ? [] : messages.map((m) => m.id),
					)
				}
				onExit={() => setIds([])}
				onVerb={(verb) => setEntry({ verb })}
			/>
			{conversion && ids.length === 0 && (
				<MakeFilterAction
					onClick={() => setEntry({ verb: "organize", fromSearch: true })}
					disabledReason={
						isConvertible(conversion)
							? undefined
							: "Add a sender or words to filter on"
					}
				/>
			)}
			<ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
				{messages.map((m) => {
					const on = ids.includes(m.id);
					return (
						<li key={m.id}>
							<button
								type="button"
								onClick={() => toggle(m.id)}
								className={[
									"flex w-full items-start gap-3 px-3 py-2.5 text-left",
									on ? "bg-accent-soft" : "",
								].join(" ")}
							>
								<span
									className={[
										"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
										on
											? "border-accent bg-accent text-accent-fg"
											: "border-line",
									].join(" ")}
								>
									{on && <Check className="size-3" />}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-baseline justify-between gap-2">
										<span className="truncate text-sm font-medium">
											{m.sender}
										</span>
										<span className="shrink-0 text-2xs text-fg-subtle">
											{m.date}
										</span>
									</span>
									<span className="block truncate text-sm">{m.subject}</span>
									<span className="block truncate text-xs text-fg-muted">
										{m.preview}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>

			{wizard}
		</div>
	);
}
