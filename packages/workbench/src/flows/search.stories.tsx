/**
 * Search, as a mode of the view the user is in.
 *
 * There is one field. On desktop it lives in the app top bar, over the panes it
 * searches; below 1024px it collapses to the list header's magnifier, and on the
 * phone that magnifier opens a full-screen takeover. Whichever surface is up,
 * the results are the same `SearchResults` sections under the same filter sheet,
 * so the tiers cannot drift apart.
 *
 * A result is the same row as an unsearched one — one `ComfortableRowBody`, so
 * the sender avatar, the unread dot and the star are there whether a message was
 * found or scrolled to. What only a search knows rides in the row's badge slot:
 * the folder it was read from, why a semantic hit matched, how strongly.
 *
 * What the search covers is on screen rather than implied: the field carries the
 * view's scope as a chip, rows from a search that spans folders say which folder
 * they came from, and spam is held out of a global search and offered back as a
 * count with a way into a Spam-scoped search.
 *
 * A query owns the pane. The filter sheet is down for as long as one is active —
 * filtering and searching narrow the same list by the same intent — and its row
 * belongs to "Make this a filter", which the pane offers for every search on
 * every view, the brief and a mailbox alike.
 */
import {
	briefFilterConfig,
	inboxFilterConfig,
	type SearchChip,
	type SearchScope,
	type Suggestion,
} from "@remit/ui";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import {
	allThreads,
	briefSections,
	briefUnseen,
	recentSearches,
	savedSearches,
	searchQuery,
	searchSections,
	searchSectionsWithoutSpam,
} from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";

const meta: Meta = {
	title: "Flows/Search",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const PHONE_WIDTH = 390;
/** The wider Android phone the brief takeover is checked against. */
const WIDE_PHONE_WIDTH = 411;
/** Below the desktop tier, so the field is the list header's own. */
const TABLET_WIDTH = 820;

const framedAt =
	(width: number): Decorator =>
	(Story) => (
		<div
			className="relative overflow-hidden rounded-lg border border-line"
			style={{ width, height: 844 }}
		>
			<Story />
		</div>
	);

const phoneFrame = framedAt(PHONE_WIDTH);

const phoneParams = {
	layout: "centered" as const,
	viewport: { value: "mobile" },
};

const flatInbox = [{ id: "inbox", threads: allThreads }];
const spamScope: SearchChip = { id: "spam", label: "in:spam", tone: "scope" };
const inboxScope: SearchChip = {
	id: "inbox",
	label: "in:inbox",
	tone: "scope",
};

/** Global search: spam is held out of the sections and offered back instead. */
const globalScope: SearchScope = {
	kind: "global",
	onScopeToSpam: () => undefined,
};
const folderScope: SearchScope = { kind: "folder", role: "inbox" };

/** The vocabulary itself, offered while a bare word is being typed. */
const tokenSuggestions: Suggestion[] = [
	{ value: "in:", label: "in:", hint: "Folder" },
	{ value: "is:unread", label: "Unread", hint: "is:unread" },
	{ value: "is:read", label: "Read", hint: "is:read" },
];

/** The folders `in:` can name, once the token name is committed. */
const folderSuggestions: Suggestion[] = [
	{ value: "in:Archive", label: "Archive", hint: "matthijs@ischen.nl" },
	{ value: "in:Inbox", label: "Inbox", hint: "matthijs@ischen.nl" },
	{ value: 'in:"Sent Items"', label: "Sent Items", hint: "work@acme.test" },
	{ value: "in:Spam", label: "Spam", hint: "matthijs@ischen.nl" },
];

const brief = {
	listTitle: "Daily brief",
	unreadCount: briefUnseen,
	sections: briefSections(),
	briefFilters: true,
};

/**
 * The unscoped search the brief runs. The field spans the panes, the list pane
 * swaps its rows for the two result sections — literal matches first, semantic
 * hits below with what they matched on — and every row names the folder it came
 * from. The spam matches are not in the sections: they are the offer above them.
 *
 * The nav offers to keep the query, under the searches already saved.
 */
export const Global: Story = {
	render: () => (
		<MailShell
			{...brief}
			query={searchQuery}
			searchSections={searchSections}
			searchScope={globalScope}
			savedSearches={savedSearches}
		/>
	),
};

/**
 * Scoped to a folder by the sidebar: the field shows the scope as a chip and the
 * rows drop their folder labels, which would only repeat that chip. Spam is out
 * of reach here, so nothing is offered.
 *
 * The mailbox offers the conversion on the same terms the brief does — search is
 * scoped by where the user is and behaves the same everywhere else — and the
 * inbox's filter sheet, which sat in that row, is down for the search.
 */
export const ScopedToFolder: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
			query={searchQuery}
			searchSections={searchSectionsWithoutSpam}
			searchScope={folderScope}
		/>
	),
};

/**
 * The inbox before anything is typed: the filter sheet has the row, and there is
 * no conversion to offer. This is the state `ScopedToFolder` returns to when the
 * query is cleared — the sheet keeps its category and toggles across the search.
 */
export const UnsearchedFolder: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
		/>
	),
};

/**
 * A query of only non-clause facets: there is nothing a filter could match on, so
 * the conversion is offered inert with the reason rather than withheld — the
 * affordance is where the user expects it, and it says what the search is missing.
 */
export const NothingToConvert: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
			query="has:attachment"
			searchSections={searchSectionsWithoutSpam}
			searchScope={folderScope}
			searchTokens={["has: attachment"]}
			makeFilterBlockedReason="Add a sender or words to filter on"
		/>
	),
};

/** Following the offer into Spam: the same query, now scoped, rows shown plainly. */
export const ScopedToSpam: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_spam"
			listTitle="Spam"
			unreadCount={2}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={spamScope}
			query={searchQuery}
			searchSections={searchSections}
			searchScope={{ kind: "folder", role: "junk" }}
		/>
	),
};

/**
 * Terms the query itself narrows by (`from:`, `has:attachment`) are chips above
 * the results, not in the field — the text the user typed already shows them,
 * and the same term twice in one field reads as two filters.
 */
export const WithFilterTokens: Story = {
	render: () => (
		<MailShell
			{...brief}
			query="from:dhl has:attachment delivery"
			searchSections={searchSections}
			searchScope={globalScope}
			searchTokens={["from: dhl", "has: attachment"]}
		/>
	),
};

/**
 * The tokens the search speaks, offered while a bare word is being typed. The
 * vocabulary is otherwise invisible — the field takes `in:`, `is:unread` and the
 * rest, and nothing on screen says so.
 *
 * The list sits under the field rather than over the results, and picking a row
 * only inserts: an unknown token stays free text, and a term with nothing to
 * offer leaves the plain text box this always is.
 */
export const SuggestingTokens: Story = {
	parameters: { layout: "centered" as const },
	decorators: [framedAt(TABLET_WIDTH)],
	render: () => (
		<MailShell
			width={TABLET_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			query="in"
			searchSections={searchSectionsWithoutSpam}
			searchScope={folderScope}
			searchSuggestions={tokenSuggestions}
		/>
	),
};

/** Both engines still out: the sections are replaced by their skeleton. */
export const Loading: Story = {
	render: () => (
		<MailShell
			{...brief}
			query={searchQuery}
			searchSections={[]}
			searchLoading
			searchScope={globalScope}
		/>
	),
};

/** Nothing matched: the query is quoted back with the filters named as a way out. */
export const NoMatches: Story = {
	render: () => (
		<MailShell
			{...brief}
			query="quarterly hedgehog report"
			searchSections={[{ id: "top", label: "Top matches", results: [] }]}
			searchScope={globalScope}
		/>
	),
};

/**
 * Phone: the magnifier opens the full-screen takeover. The field and the result
 * sections are the same components desktop mounts; the one X clears the query and
 * closes the takeover together. The takeover's filter sheet belongs to the empty
 * field (see `PhoneRecentSearches`) — with a query up, the conversion has the row.
 */
export const PhoneTakeover: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			query={searchQuery}
			searchSections={searchSections}
			searchScope={globalScope}
			recentSearches={recentSearches}
			searchOpen
		/>
	),
};

/**
 * The brief's search on a phone, where the takeover covers the list it searches.
 * The rows are the brief's own rows — avatar, unread dot, star, snippet — so the
 * takeover reads as the same list narrowed, not as a second list that resembles
 * it. Framed at 411px, the wider Android phone.
 */
export const PhoneBriefTakeover: Story = {
	parameters: phoneParams,
	decorators: [framedAt(WIDE_PHONE_WIDTH)],
	render: () => (
		<MailShell
			{...brief}
			width={WIDE_PHONE_WIDTH}
			preset={briefFilterConfig()}
			query={searchQuery}
			searchSections={searchSections}
			searchScope={globalScope}
			recentSearches={recentSearches}
			searchOpen
		/>
	),
};

/**
 * The mailbox takeover on the wider Android phone, at 411px. The conversion row
 * fits above the sections at the narrowest width the app supports, and the inbox
 * filter sheet that would otherwise sit there is down for the search.
 */
export const PhoneFolderTakeover: Story = {
	parameters: phoneParams,
	decorators: [framedAt(WIDE_PHONE_WIDTH)],
	render: () => (
		<MailShell
			width={WIDE_PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
			query={searchQuery}
			searchSections={searchSectionsWithoutSpam}
			searchScope={folderScope}
			recentSearches={recentSearches}
			searchOpen
		/>
	),
};

/**
 * A committed token name on the phone, at 411px: the folders `in:` can name,
 * each one the shortest spelling that still resolves to it, with the account it
 * belongs to beside it.
 *
 * The list takes its own space between the field and the results. A soft
 * keyboard owns the lower half of the screen here, so a list floating over the
 * field would cover the query it is completing.
 */
export const PhoneSuggestingFolders: Story = {
	parameters: phoneParams,
	decorators: [framedAt(WIDE_PHONE_WIDTH)],
	render: () => (
		<MailShell
			width={WIDE_PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			query="in:"
			searchSections={searchSectionsWithoutSpam}
			searchScope={folderScope}
			searchSuggestions={folderSuggestions}
			recentSearches={recentSearches}
			searchOpen
		/>
	),
};

/**
 * The takeover with an empty field: the searches the user ran before, under the
 * filter sheet. Nothing is being searched, so the sheet keeps the row.
 */
export const PhoneRecentSearches: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			searchSections={searchSections}
			searchScope={globalScope}
			recentSearches={recentSearches}
			searchOpen
		/>
	),
};
