/**
 * The mail shell as the app mounts it.
 *
 * `AppShellSlotted` is the shell the live `/mail` route renders: it takes the
 * nav, top bar, list, reading and intelligence slots as nodes and owns only the
 * responsive arrangement. These stories fill those slots the way the route does
 * (see `MailShell`), so what shows here is the screen the user gets — the top
 * bar over the panes it searches, a list header with no second search field, and
 * the FAB and slide-over nav below 1024px.
 *
 * One responsive surface: drag the viewport and the same shell reflows. The
 * reading pane joins at 1024px along with the nav column and the top bar; the
 * intelligence rail joins at 1280px when a thread is open.
 */
import { AppShellSlotted, inboxFilterConfig, type SearchChip } from "@remit/ui";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import {
	allThreads,
	briefSections,
	briefUnseen,
	flaggedThreads,
	q3Intelligence,
	q3Thread,
	savedSearches,
} from "../fixtures/workspace.js";
import { MailShell } from "./mail-shell.js";

const meta: Meta<typeof AppShellSlotted> = {
	title: "Screens/AppShell",
	component: AppShellSlotted,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShellSlotted>;

const flatInbox = [{ id: "inbox", threads: allThreads }];
const inboxScope: SearchChip = {
	id: "inbox",
	label: "in:inbox",
	tone: "scope",
};

const PHONE_WIDTH = 390;
const TABLET_WIDTH = 900;

/** Frames a story at a fixed width so the shell's own reflow resolves there. */
const frame = (width: number, height: number): Decorator =>
	function Frame(Story) {
		return (
			<div
				className="relative overflow-hidden rounded-lg border border-line"
				style={{ width, height }}
			>
				<Story />
			</div>
		);
	};

const framed = { layout: "centered" as const };

/**
 * The daily brief at desktop width: nav column, the app top bar over the three
 * panes it searches, the sectioned brief, the open thread, and the intelligence
 * rail. The list header carries the view name and unread count and no search
 * field — the top bar owns the one field on the page.
 */
export const Default: Story = {
	render: () => (
		<MailShell
			listTitle="Daily brief"
			unreadCount={briefUnseen}
			sections={briefSections()}
			briefFilters
			thread={q3Thread}
			selectedThreadId="thr_q3"
			intelligence={q3Intelligence}
			savedSearches={savedSearches}
		/>
	),
};

/**
 * A plain mailbox: the flat list with the filter sheet slotted above it, and the
 * scope of the view carried into the search field as a chip. Removing the chip
 * takes the search back to everything.
 */
export const Inbox: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
			thread={q3Thread}
			selectedThreadId="thr_q3"
			intelligence={q3Intelligence}
		/>
	),
};

/** Rail closed: the reading pane takes the freed width, the toggle stays live. */
export const IntelligenceClosed: Story = {
	render: () => (
		<MailShell
			listTitle="Daily brief"
			unreadCount={briefUnseen}
			sections={briefSections()}
			briefFilters
			thread={q3Thread}
			selectedThreadId="thr_q3"
			intelligence={q3Intelligence}
			intelligenceOpen={false}
		/>
	),
};

/**
 * Nothing open: the reading pane shows its zero state and the rail has nothing
 * to open, so its toggle greys out. The mail verbs stay pressable.
 */
export const NoThreadOpen: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={flaggedThreads.filter((t) => !t.isRead).length}
			sections={[{ id: "flagged", threads: flaggedThreads }]}
			preset={inboxFilterConfig()}
		/>
	),
};

/**
 * 1024–1279px: nav, list and reading pane, no room for the intelligence rail.
 * The top bar is mounted here already — it arrives with the reading pane.
 */
export const TwoPane: Story = {
	parameters: framed,
	decorators: [frame(1100, 760)],
	render: () => (
		<MailShell
			width={1100}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			thread={q3Thread}
			selectedThreadId="thr_q3"
			intelligence={q3Intelligence}
		/>
	),
};

/**
 * Tablet (below 1024px): one pane. There is no row of panes for a bar to span,
 * so the top bar is not mounted and search returns to the list header's
 * magnifier; compose moves to the FAB and the nav becomes a slide-over.
 */
export const TabletSinglePane: Story = {
	parameters: framed,
	decorators: [frame(TABLET_WIDTH, 760)],
	render: () => (
		<MailShell
			width={TABLET_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
		/>
	),
};

/** Phone: the same single pane, narrower. */
export const Phone: Story = {
	parameters: { ...framed, viewport: { value: "mobile" } },
	decorators: [frame(PHONE_WIDTH, 844)],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
		/>
	),
};

/** The nav as a slide-over, which is the only way it shows below 1024px. */
export const PhoneNavSlideOver: Story = {
	parameters: { ...framed, viewport: { value: "mobile" } },
	decorators: [frame(PHONE_WIDTH, 844)],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={flatInbox}
			preset={inboxFilterConfig()}
			navOpen
		/>
	),
};

/** Cold load: the route paints its skeleton before config arrives. */
export const Loading: Story = {
	render: () => <MailShell isLoading />,
};
