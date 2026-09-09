import { flaggedFilterConfig } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { flaggedThreads } from "../fixtures/workspace.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * Flagged — the virtual mailbox reintroduced in #982. A FLAT, cross-account
 * inbox of starred mail: no category sections, no account chip bar, just one
 * continuous list of every flagged thread. "Flagged" is the active nav item,
 * directly under "Daily brief".
 *
 * Its filtered states and its header count are #310. Both used to be computed
 * over the pages the user happened to have loaded: a category whose mail sat
 * below the newest page showed an empty list, and the number beside the title
 * grew with every press of "Load more" while reading as a total. The filter is
 * a query parameter now and the count is the server's own, which is what these
 * stories describe.
 */
const meta: Meta = {
	title: "Flows/Flagged",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const flaggedSection = [{ id: "flagged", threads: flaggedThreads }];
const personalThreads = flaggedThreads.filter(
	(thread) => thread.category === "personal",
);
const personalSection = [{ id: "flagged", threads: personalThreads }];

/**
 * The cross-account total the server answered, not a page length. It is the
 * count of starred CONVERSATIONS that are unread under the active filters, so
 * it does not move when a further page is loaded.
 */
const STARRED_UNREAD_TOTAL = 42;
const PERSONAL_UNREAD_TOTAL = 7;

/** The filter as the empty state renders it: label, escape, and how far it read. */
const personalFilter = {
	label: "Personal mail",
	reach: "whole-folder" as const,
	onClear: () => undefined,
};

const flaggedPreset = flaggedFilterConfig();

/**
 * Starred mail across every account in one flat list. Rows span the personal
 * and work accounts — the star is the only thing they share. Flat, like a plain
 * inbox, never the sectioned brief.
 */
export const Default: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={STARRED_UNREAD_TOTAL}
			sections={flaggedSection}
		/>
	),
};

/** Phone width (390 px): the same flat starred list, single-pane. */
export const Phone: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={STARRED_UNREAD_TOTAL}
			sections={flaggedSection}
		/>
	),
};

/**
 * S1 — a category filter is active and starred mail came back for it. The rows
 * are the server's answer over the whole collection, so what is on screen is
 * every match and not the matches that happened to be in the newest page. The
 * title stays `Starred`; the chip bar carries the filter's identity.
 */
export const FilteredWithResults: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={PERSONAL_UNREAD_TOTAL}
			sections={personalSection}
			preset={flaggedPreset}
			briefCategory="personal"
			filterOpen
		/>
	),
};

/**
 * S2 — the filter is active and no starred mail matches it. Distinct from an
 * empty starred collection and from loading, and it says how much was looked
 * at: the criterion is a column on the row, so the whole collection was
 * checked and there is genuinely none. Never `No messages in this mailbox` —
 * Flagged spans accounts and is not a mailbox.
 */
export const FilteredEmpty: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={0}
			sections={[]}
			listState="empty"
			listFilter={personalFilter}
			preset={flaggedPreset}
			briefCategory="personal"
			filterOpen
		/>
	),
};

/**
 * S2 with a free-text query on top of the filter. The server matches subject
 * and From over the whole collection, but the snippet half of the search only
 * sees the pages loaded so far, so the completeness sentence claims no more
 * than that.
 */
export const FilteredEmptyBoundedReach: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={0}
			sections={[]}
			listState="empty"
			listFilter={{ ...personalFilter, reach: "loaded-pages" }}
			preset={flaggedPreset}
			briefCategory="personal"
			filterOpen
		/>
	),
};

/**
 * S3 — a further page in flight under an active filter. Flagged pages on a text
 * button rather than on scroll, so the button carries the state and says
 * `Loading…` while the request is out. No footer sentence: that belongs to the
 * list that fetches on scroll, where there is no control to say it on.
 */
export const FilteredFetchingMore: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={PERSONAL_UNREAD_TOTAL}
			sections={personalSection}
			preset={flaggedPreset}
			briefCategory="personal"
			filterOpen
			listBody={<FilteredListBody loadingMore />}
		/>
	),
};

/** S3's resting state: rows and the button that fetches the next page. */
export const FilteredWithMorePages: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={PERSONAL_UNREAD_TOTAL}
			sections={personalSection}
			preset={flaggedPreset}
			briefCategory="personal"
			filterOpen
			listBody={<FilteredListBody />}
		/>
	),
};

/**
 * S4's fallback. The number beside the title is the server's own total; when
 * the server has not answered one the header shows no number at all, rather
 * than the length of the pages that happen to be loaded. There is no third
 * state: a page length is not a count.
 */
export const CountUnavailable: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={null}
			sections={flaggedSection}
		/>
	),
};

/**
 * S5 — nothing is starred and no filter is active. `No messages in Starred`:
 * the collection names itself, because "this mailbox" was never true of a set
 * that spans accounts and folders.
 */
export const Empty: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={0}
			sections={[]}
			listState="empty"
		/>
	),
};

/**
 * The rows Flagged scrolls plus its pager, mirroring `FlaggedList`'s own body:
 * a text button, `Loading…` while a page is in flight.
 */
function FilteredListBody({ loadingMore }: { loadingMore?: boolean }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex-1 overflow-y-auto">
				<div className="divide-y divide-line">
					{personalThreads.map((thread) => (
						<div key={thread.id} className="px-3 py-2">
							<div className="flex items-center justify-between">
								<span className="truncate font-medium text-fg text-sm">
									{thread.fromName}
								</span>
								<span className="shrink-0 text-2xs text-fg-subtle">
									{thread.timeLabel}
								</span>
							</div>
							<div className="truncate text-fg text-sm">{thread.subject}</div>
							<div className="truncate text-fg-muted text-xs">
								{thread.snippet}
							</div>
						</div>
					))}
				</div>
				<button
					type="button"
					className="w-full py-3 text-fg-muted text-sm disabled:opacity-50"
					disabled={loadingMore}
				>
					{loadingMore ? "Loading…" : "Load more"}
				</button>
			</div>
		</div>
	);
}
