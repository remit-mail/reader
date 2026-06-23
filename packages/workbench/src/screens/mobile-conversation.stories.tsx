import { AppShell, type AppShellProps } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	allThreads,
	navAccounts,
	newsletterIntelligence,
	newsletterThread,
	phishIntelligence,
	phishThread,
	q3Intelligence,
	q3Thread,
} from "../fixtures/workspace.js";

/**
 * The phone reading view is the real AppShell, narrowed. Below 1024px the shell
 * collapses to a single pane that swaps in place between the list and a
 * dedicated message view; these stories open it straight to a thread
 * (`initialNarrowView="message"`) at iPhone 14 width. There is no separate mobile
 * mock — the same component drives every width.
 */

const PHONE_WIDTH = 390;

/** A flat inbox so the back-from-message lands on the plain mailbox list. */
const flatInboxSection = [{ id: "inbox", threads: allThreads }];

/** Renders the real AppShell seeded to phone width so the container-query reflow
 *  resolves to the single-pane touch layout. The shell fills the mobile viewport
 *  (the iPhone 14 frame is the canvas), so back/message and the bottom action bar
 *  sit exactly where they do live. */
function PhoneShell(overrides: Partial<AppShellProps>) {
	return (
		<AppShell
			accounts={navAccounts}
			initialWidth={PHONE_WIDTH}
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			flatList
			sections={flatInboxSection}
			{...overrides}
		/>
	);
}

const meta: Meta = {
	title: "Screens/MobileConversation",
	parameters: {
		layout: "fullscreen",
		viewport: { value: "mobile" },
	},
};
export default meta;

type Story = StoryObj;

/**
 * Phone reading view: the dedicated message pane the shell swaps in below 1024px.
 * Back (top-left) returns to the list; the ⓘ button opens the intelligence
 * drawer. Top bar + bottom action bar are the real shared remit-ui components.
 */
export const Default: Story = {
	render: () => (
		<PhoneShell
			selectedThreadId="thr_q3"
			thread={q3Thread}
			intelligence={q3Intelligence}
			initialNarrowView="message"
		/>
	),
};

/**
 * Phone intelligence drawer — newsletter sender (design baseline for #854).
 *
 * The drawer is the real `IntelligencePanel` hung off the message view via the
 * shared Dialog (right-anchored, w-[80vw] max-w-[320px]). The Dialog header owns
 * the sole close affordance; the panel's own X is suppressed — one way back
 * (#874). All five quick actions (VIP, Mute, Block, Unsubscribe, Auto-archive)
 * render for a newsletter sender.
 *
 * Open the drawer from the ⓘ button in the message view's top bar.
 */
export const PhoneIntelligenceDrawer: Story = {
	render: () => (
		<PhoneShell
			selectedThreadId="thr_marketing"
			thread={newsletterThread}
			intelligence={newsletterIntelligence}
			initialNarrowView="message"
		/>
	),
};

/**
 * Phone intelligence drawer — phishing sender variant (#854/#874).
 *
 * A DKIM-mismatch sender: the message body carries the danger banner and the
 * intelligence drawer renders the red authenticity card plus the
 * similar-messages affordance. Same drawer chrome and quick-actions set as the
 * newsletter variant.
 */
export const PhoneIntelligenceDrawerPhishing: Story = {
	render: () => (
		<PhoneShell
			selectedThreadId="thr_phish"
			thread={phishThread}
			intelligence={phishIntelligence}
			initialNarrowView="message"
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Phone triage interactions, shown statically so the user can eyeball */
/* them without driving the gestures. Same real AppShell, narrow list. */
/* ------------------------------------------------------------------ */

/**
 * Phone selection mode: long-press promotes the list to multi-select. The list
 * header is REPLACED by the selection bar (cancel + count + mark-read + delete,
 * real Buttons, never disabled), and each selected row's avatar becomes a
 * checkbox. Seeded here with the first two rows checked.
 */
export const PhoneSelectionMode: Story = {
	render: () => <PhoneShell initialTouchState="selection" />,
};

/**
 * Phone swipe — trailing: a row swiped left to reveal the destructive delete
 * action on danger (the iOS-style trailing swipe). Tap the row to settle it back.
 */
export const PhoneSwipeDelete: Story = {
	render: () => <PhoneShell initialTouchState="peek-trailing" />,
};

/**
 * Phone swipe — leading: a row swiped right to reveal the toggle-read action on
 * accent-2 (the leading swipe). Tap the row to settle it back.
 */
export const PhoneSwipeToggleRead: Story = {
	render: () => <PhoneShell initialTouchState="peek-leading" />,
};
