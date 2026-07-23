/**
 * Search, as a mode of the view the user is in.
 *
 * There is one field. On desktop it lives in the app top bar, over the panes it
 * searches; below 1024px it collapses to the list header's magnifier, and on the
 * phone that magnifier opens a full-screen takeover. Whichever surface is up,
 * the results are the same `SearchResults` sections under the same filter sheet,
 * so the tiers cannot drift apart.
 *
 * What the search covers is on screen rather than implied: the field carries the
 * view's scope as a chip, rows from a search that spans folders say which folder
 * they came from, and spam is held out of a global search and offered back as a
 * count with a way into a Spam-scoped search.
 */
import {
	inboxFilterConfig,
	type SearchChip,
	type SearchScope,
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

const phoneFrame: Decorator = (Story) => (
	<div
		className="relative overflow-hidden rounded-lg border border-line"
		style={{ width: PHONE_WIDTH, height: 844 }}
	>
		<Story />
	</div>
);

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
 * Phone: the magnifier opens the full-screen takeover. The field, the filter
 * sheet and the result sections are the same components desktop mounts; the one
 * X clears the query and closes the takeover together.
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

/** The takeover with an empty field: the searches the user ran before. */
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
