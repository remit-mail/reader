import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { NavAccount, NavLinkComponent } from "./app-shell-types.js";
import {
	NAV_ACCOUNT_OPEN_KEY,
	NAV_FOLDER_OPEN_KEY,
	NavSidebar,
	readOpen,
	writeOpen,
} from "./nav-sidebar.js";

const accounts: NavAccount[] = [
	{
		id: "acct-personal",
		label: "Personal",
		email: "matthijs@example.com",
		mailboxes: [
			{ id: "personal-inbox", name: "Inbox", unseen: 12 },
			{ id: "personal-sent", name: "Sent", specialUse: ["\\Sent"] },
			{ id: "personal-trash", name: "Trash", specialUse: ["\\Trash"] },
			{ id: "personal-travel", name: "Travel", fullPath: "Personal/Travel" },
		],
	},
];

/** Minimal in-memory localStorage stub for the persistence contract tests. */
class MemoryStorage {
	private store = new Map<string, string>();
	getItem(key: string): string | null {
		return this.store.has(key) ? (this.store.get(key) ?? null) : null;
	}
	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
	removeItem(key: string): void {
		this.store.delete(key);
	}
	clear(): void {
		this.store.clear();
	}
}

/** An anchor-rendering linkComponent so we can assert real <a href> output. */
const hrefLink: NavLinkComponent = ({
	navId,
	className,
	ariaLabel,
	title,
	children,
}) =>
	createElement(
		"a",
		{ href: `/mail/${navId}`, className, "aria-label": ariaLabel, title },
		children,
	);

describe("NavSidebar", () => {
	it("renders the daily brief item", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				briefUnseen: 7,
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /Daily brief/);
	});

	it("renders system and custom mailbox names", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /Inbox/);
		assert.match(html, /Sent/);
		assert.match(html, /Trash/);
		assert.match(html, /Travel/);
	});

	it("gives the selected item its active accent styling", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /bg-accent-2-soft/);
		assert.match(html, /text-accent-2/);
	});

	it("renders navigation entries as anchors via linkComponent", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
				linkComponent: hrefLink,
			}),
		);
		// Brief, system mailbox, and folder all become real <a href> links.
		assert.match(html, /<a href="\/mail\/brief"/);
		assert.match(html, /<a href="\/mail\/personal-inbox"/);
		assert.match(html, /<a href="\/mail\/personal-travel"/);
	});

	it("carries aria-label and the fullPath title on a mailbox link", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
				linkComponent: hrefLink,
			}),
		);
		assert.match(html, /aria-label="Inbox"/);
		assert.match(html, /title="Personal\/Travel"/);
	});

	it("renders an Outbox entry with its pending count when set", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts: [{ ...accounts[0], outboxPending: 3 }],
				selectedNavId: "outbox",
				onSelectNav: () => undefined,
				linkComponent: hrefLink,
			}),
		);
		assert.match(html, /Outbox/);
		assert.match(html, /<a href="\/mail\/outbox"/);
		assert.match(html, /3/);
	});

	it("omits the Outbox entry when outboxPending is undefined", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts,
				selectedNavId: "personal-inbox",
				onSelectNav: () => undefined,
			}),
		);
		assert.doesNotMatch(html, /Outbox/);
	});

	it("shows the empty state when no accounts are configured", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts: [],
				selectedNavId: "brief",
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /No accounts configured/);
	});

	it("shows a per-account loading placeholder", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts: [{ ...accounts[0], status: "loading", mailboxes: [] }],
				selectedNavId: "brief",
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /Loading/);
	});

	it("shows a per-account error with a retry affordance", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts: [
					{
						...accounts[0],
						status: "error",
						onRetry: () => undefined,
						mailboxes: [],
					},
				],
				selectedNavId: "brief",
				onSelectNav: () => undefined,
			}),
		);
		// renderToString HTML-escapes the apostrophe in "Couldn't".
		assert.match(html, /Couldn(?:'|&#x27;)t load mailboxes/);
		assert.match(html, /Retry/);
	});

	it("shows the no-mailboxes copy for a ready account with none", () => {
		const html = renderToString(
			createElement(NavSidebar, {
				accounts: [{ ...accounts[0], status: "ready", mailboxes: [] }],
				selectedNavId: "brief",
				onSelectNav: () => undefined,
			}),
		);
		assert.match(html, /No mailboxes/);
	});
});

describe("NavSidebar collapse persistence", () => {
	afterEach(() => {
		Reflect.deleteProperty(globalThis, "localStorage");
	});

	it("defaults to open when nothing is stored", () => {
		(globalThis as { localStorage?: Storage }).localStorage =
			new MemoryStorage() as unknown as Storage;
		assert.equal(readOpen(NAV_FOLDER_OPEN_KEY, "acct-1", true), true);
		assert.equal(readOpen(NAV_ACCOUNT_OPEN_KEY, "acct-1", true), true);
	});

	it("round-trips a stored collapsed flag per id", () => {
		(globalThis as { localStorage?: Storage }).localStorage =
			new MemoryStorage() as unknown as Storage;
		writeOpen(NAV_ACCOUNT_OPEN_KEY, "acct-1", false);
		assert.equal(readOpen(NAV_ACCOUNT_OPEN_KEY, "acct-1", true), false);
		// A different id is unaffected — collapse is keyed per account.
		assert.equal(readOpen(NAV_ACCOUNT_OPEN_KEY, "acct-2", true), true);
	});

	it("honours the supplied fallback with no storage available", () => {
		// No localStorage on globalThis → return fallback verbatim.
		assert.equal(readOpen(NAV_FOLDER_OPEN_KEY, "acct-1", false), false);
		assert.equal(readOpen(NAV_FOLDER_OPEN_KEY, "acct-1", true), true);
	});
});
