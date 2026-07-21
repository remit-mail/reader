import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppShell } from "./app-shell.js";
import type { AppShellProps, ThreadSection } from "./app-shell-types.js";
import { commitPeek } from "./swipeable-row.js";

const baseAccounts: AppShellProps["accounts"] = [
	{
		id: "acc",
		label: "Personal",
		email: "me@example.com",
		mailboxes: [{ id: "mbx_inbox", name: "Inbox", unseen: 2 }],
	},
];

const labelledSection: ThreadSection = {
	id: "sec",
	label: "Today",
	threads: [
		{
			id: "t1",
			accountId: "acc",
			fromName: "Ada Lovelace",
			fromEmail: "ada@example.com",
			subject: "Hello",
			snippet: "First message",
			timeLabel: "09:00",
		},
	],
};

const render = (overrides: Partial<AppShellProps>) =>
	renderToString(
		createElement(AppShell, {
			accounts: baseAccounts,
			selectedNavId: "mbx_inbox",
			listTitle: "Inbox",
			sections: [labelledSection],
			...overrides,
		}),
	);

const intelligence: AppShellProps["intelligence"] = {
	sender: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.com",
		summary: "Signed by example.com, matches the sender.",
	},
	category: { value: "personal" },
	similar: [],
};

const thread: AppShellProps["thread"] = {
	subject: "Hello",
	messages: [
		{
			id: "m1",
			fromName: "Ada Lovelace",
			fromEmail: "ada@example.com",
			toLabel: "me",
			dateLabel: "09:00",
			snippet: "First message",
			bodyHtml: "<p>First message</p>",
			expanded: true,
		},
	],
};

// Section labels are a desktop-list affordance; the narrow touch surface is a
// single flat list (see the narrow-view block below). The shell reflows by its
// OWN width now, seeded for SSR via `initialWidth`, so these seed the container
// to desktop to exercise the sectioned-vs-flat distinction itself.
describe("AppShell flat list (#5/#7)", () => {
	it("renders section labels in the default sectioned list", () => {
		const html = render({ initialWidth: 1100 });
		assert.match(html, /Today/, "sectioned list shows its label");
	});

	it("suppresses section labels in a flat mailbox", () => {
		const html = render({ flatList: true, initialWidth: 1100 });
		assert.doesNotMatch(
			html,
			/>Today</,
			"flat list is one continuous list, no section headers",
		);
		assert.match(html, /Ada Lovelace/, "rows still render");
	});
});

/**
 * Pane-count-by-width is owned by `resolvePaneLayout` — see
 * pane-layout.render.test.ts for the boundary cases. This block only confirms
 * the rendered shell *wires to* that helper: the reading pane and intelligence
 * rail actually appear/disappear in the HTML as the seeded container width
 * crosses the two thresholds (no duplicate enumeration of the boundaries).
 */
describe("AppShell render honors the pane layout (#784)", () => {
	const readingPaneProps: Partial<AppShellProps> = {
		flatList: true,
		selectedThreadId: "m1",
		thread,
		intelligence,
	};
	// The reading pane's toolbar is the only place "Search mail" renders.
	const readingPaneMarker = /Search mail/;
	// "Known sender" is the wellknown trust label, rendered only by the rail.
	const intelligenceMarker = /Known sender/;

	// The shell reflows by its OWN width (container query / ResizeObserver),
	// seeded for SSR via `initialWidth`.
	it("list-only below 1024: neither reading pane nor rail in the HTML", () => {
		const html = render({ ...readingPaneProps, initialWidth: 800 });
		assert.match(html, /Ada Lovelace/, "the list still renders");
		assert.doesNotMatch(html, readingPaneMarker, "reading pane is absent");
		assert.doesNotMatch(html, intelligenceMarker, "rail is absent");
	});

	it("reading pane appears at 1024, rail still held until 1280", () => {
		const html = render({ ...readingPaneProps, initialWidth: 1100 });
		assert.match(html, readingPaneMarker, "reading pane is present");
		assert.doesNotMatch(html, intelligenceMarker, "rail holds until ≥1280px");
	});

	it("rail joins the reading pane at 1280", () => {
		const html = render({ ...readingPaneProps, initialWidth: 1400 });
		assert.match(html, readingPaneMarker, "reading pane is present");
		assert.match(html, intelligenceMarker, "rail joins at xl");
	});
});

describe("AppShell nav: pane vs slide-over by width (#784)", () => {
	// The nav sidebar's own items — present only when the nav renders.
	const navMarker = /Daily brief/;
	// The list-header folders button opens the slide-over at narrow widths.
	const navTriggerMarker = /aria-label="Open folders"/;

	it("below 1024px: nav is not a persistent pane, reached via the trigger", () => {
		const html = render({ flatList: true, initialWidth: 800 });
		assert.doesNotMatch(
			html,
			navMarker,
			"nav is not in the persistent layout (drawer is closed)",
		);
		assert.match(html, navTriggerMarker, "the folders trigger is present");
	});

	it("≥1024px: nav is a persistent pane, no trigger", () => {
		const html = render({ flatList: true, initialWidth: 1100 });
		assert.match(html, navMarker, "nav renders as a pane");
		assert.match(html, /Settings/, "the desktop nav pins a Settings footer");
		assert.doesNotMatch(
			html,
			navTriggerMarker,
			"no folders trigger when the nav is a pane",
		);
	});
});

describe("AppShell narrow message view: width-gated in-place swap", () => {
	const withThread: Partial<AppShellProps> = {
		flatList: true,
		selectedThreadId: "m1",
		thread,
		intelligence,
	};
	// The dedicated message view's back affordance — present only when the
	// narrow single pane is showing the message view.
	const messageViewMarker = /aria-label="Back to messages"/;
	// The desktop reading-pane toolbar — present only at/above 1024.
	const readingPaneMarker = /Search mail/;

	it("below 1024 defaults to the list, not the message view", () => {
		const html = render({ ...withThread, initialWidth: 800 });
		assert.doesNotMatch(html, messageViewMarker, "starts on the list");
		assert.match(html, /Ada Lovelace/, "the list renders");
	});

	it("below 1024 the message view takes over the single pane when opened", () => {
		const html = render({
			...withThread,
			initialWidth: 800,
			initialNarrowView: "message",
		});
		assert.match(html, messageViewMarker, "the message view is shown");
		assert.doesNotMatch(
			html,
			readingPaneMarker,
			"no desktop reading pane at narrow width",
		);
	});

	it("at/above 1024 the swap is ignored — thread fills the reading pane", () => {
		const html = render({
			...withThread,
			initialWidth: 1100,
			initialNarrowView: "message",
		});
		assert.match(
			html,
			readingPaneMarker,
			"the reading pane renders the thread",
		);
		assert.doesNotMatch(
			html,
			messageViewMarker,
			"the narrow message view never appears once the reading pane fits",
		);
	});
});

describe("AppShell narrow touch triage (#swipe/selection/pull)", () => {
	// The pull-to-refresh affordance + swipe action labels live only in the
	// narrow touch list body. The touch gate is container-derived (the shell's
	// own width), seeded for SSR via `initialWidth`.
	it("below 1024 the ready list is the touch surface (pull-to-refresh)", () => {
		const html = render({ flatList: true, initialWidth: 800 });
		assert.match(
			html,
			/Pull to refresh/,
			"the pull-to-refresh hint is present",
		);
	});

	it("at/above 1024 the desktop list has no touch chrome", () => {
		const html = render({ flatList: true, initialWidth: 1100 });
		assert.doesNotMatch(
			html,
			/Pull to refresh/,
			"no pull-to-refresh on the desktop list",
		);
	});
});

describe("AppShell touch-state seeds (story/SSR affordance)", () => {
	// A two-row flat list so the seeds (first-two-checked / peek the 2nd row)
	// have rows to land on.
	const twoRows: ThreadSection = {
		id: "inbox",
		threads: [
			{
				id: "r1",
				accountId: "acc",
				fromName: "Ada Lovelace",
				fromEmail: "ada@example.com",
				subject: "First",
				snippet: "one",
				timeLabel: "09:00",
			},
			{
				id: "r2",
				accountId: "acc",
				fromName: "Grace Hopper",
				fromEmail: "grace@example.com",
				subject: "Second",
				snippet: "two",
				timeLabel: "09:05",
			},
		],
	};
	const touchBase: Partial<AppShellProps> = {
		flatList: true,
		initialWidth: 390,
		sections: [twoRows],
	};

	const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
	// The swipe-action backgrounds. `bg-accent-2` must not match `bg-accent-2-soft`
	// (the row's active highlight), so require a non-`-`/letter boundary after it.
	const trailingAction = /bg-danger/g;
	const leadingAction = /bg-accent-2(?![-a-z])/g;

	// Regression (the bug the user caught): at REST every row was leaking its
	// trailing delete action because the transparent row didn't cover the layer
	// behind it. No row is peeked here, so zero action zones may be visible.
	it("at rest shows NO swipe-action zone on any row", () => {
		const html = render(touchBase);
		assert.equal(
			count(html, trailingAction),
			0,
			"no trailing (delete) action visible at rest",
		);
		assert.equal(
			count(html, leadingAction),
			0,
			"no leading (toggle-read) action visible at rest",
		);
	});

	it("selection seed shows the selection bar replacing the header", () => {
		const html = render({ ...touchBase, initialTouchState: "selection" });
		assert.match(
			html,
			/aria-label="Cancel selection"/,
			"the selection bar is shown",
		);
		assert.match(html, /2 messages selected/, "selection wording shown");
		// Selection mode is not a swipe — no action zones revealed.
		assert.equal(
			count(html, trailingAction),
			0,
			"no swipe action in selection",
		);
		assert.equal(count(html, leadingAction), 0, "no swipe action in selection");
	});

	it("peek-trailing reveals exactly one row's delete action, no leading", () => {
		const html = render({ ...touchBase, initialTouchState: "peek-trailing" });
		assert.match(html, /translateX\(-72px\)/, "the second row is peeked left");
		assert.equal(
			count(html, trailingAction),
			1,
			"exactly one trailing action is revealed",
		);
		assert.equal(count(html, leadingAction), 0, "no leading action leaks");
		// the revealed action is a real button that performs the action
		assert.match(
			html,
			/<button[^>]*aria-label="Delete message"/,
			"delete action is a tappable button",
		);
	});

	it("peek-leading reveals exactly one row's toggle-read action, no trailing", () => {
		const html = render({ ...touchBase, initialTouchState: "peek-leading" });
		assert.match(html, /translateX\(72px\)/, "the second row is peeked right");
		assert.equal(
			count(html, leadingAction),
			1,
			"exactly one leading action is revealed",
		);
		assert.equal(count(html, trailingAction), 0, "no trailing action leaks");
		assert.match(
			html,
			/<button[^>]*aria-label="Mark as (read|unread)"/,
			"toggle-read action is a tappable button",
		);
	});

	it("selectionBar overrides the built-in bar and forwards to the list pane", () => {
		const html = render({
			...touchBase,
			selectionBar: createElement(
				"div",
				{ "data-testid": "custom-bar" },
				"Deleting 1,200 of 3,412…",
			),
		});
		assert.match(html, /Deleting 1,200 of 3,412…/, "the override renders");
		assert.doesNotMatch(
			html,
			/aria-label="Cancel selection"/,
			"the built-in bar is not also rendered",
		);
	});

	it("ignores the touch seed at/above 1024 (desktop list)", () => {
		const html = render({
			...touchBase,
			initialWidth: 1100,
			initialTouchState: "selection",
		});
		assert.doesNotMatch(
			html,
			/aria-label="Cancel selection"/,
			"no selection bar on the desktop list",
		);
	});
});

describe("AppShell list states (#5/#7)", () => {
	it("renders the skeleton when loading, not the rows", () => {
		const html = render({ flatList: true, listState: "loading" });
		assert.match(html, /animate-pulse/);
		assert.doesNotMatch(html, /Ada Lovelace/, "rows replaced by skeleton");
	});

	it("renders the empty mailbox copy", () => {
		const html = render({ flatList: true, listState: "empty", sections: [] });
		assert.match(html, /No messages in this mailbox/);
	});

	it("renders the search-empty copy when a query is active", () => {
		const html = render({
			flatList: true,
			listState: "empty",
			sections: [],
			searchQuery: "invoice",
		});
		assert.match(html, /No messages match your search/);
	});

	it("fails hard on error with retry + report, never a disabled control", () => {
		const html = render({
			flatList: true,
			listState: "error",
			sections: [],
			onRetry: () => {},
			onReportError: () => {},
		});
		assert.match(html, /role="alert"/);
		assert.match(html, /Couldn&#x27;t load messages/);
		assert.match(html, /Retry/);
		assert.match(html, /Report a problem/);
		assert.doesNotMatch(html, /\sdisabled[\s=>]/);
	});
});

// The interactive swipe is a pointer drag; its release rule is `commitPeek`,
// kept pure so it's testable without a DOM (SSR can't fire pointer events).
describe("commitPeek — drag-release snap rule", () => {
	it("snaps back to none when the drag is short of half the action width", () => {
		assert.equal(commitPeek(0), "none");
		assert.equal(commitPeek(35), "none", "just under half (36) stays closed");
		assert.equal(commitPeek(-35), "none");
	});

	it("commits to a side once the drag passes half the action width", () => {
		assert.equal(commitPeek(36), "leading", "dragged right past half");
		assert.equal(commitPeek(72), "leading", "fully dragged right");
		assert.equal(commitPeek(-36), "trailing", "dragged left past half");
		assert.equal(commitPeek(-72), "trailing", "fully dragged left");
	});
});
