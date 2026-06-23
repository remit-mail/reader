import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { NavAccount } from "./app-shell-types.js";
import { NavSidebar } from "./nav-sidebar.js";

const accounts: NavAccount[] = [
	{
		id: "acct-personal",
		label: "Personal",
		email: "matthijs@example.com",
		mailboxes: [
			{ id: "personal-inbox", name: "Inbox", unseen: 12 },
			{ id: "personal-sent", name: "Sent", specialUse: ["\\Sent"] },
			{ id: "personal-trash", name: "Trash", specialUse: ["\\Trash"] },
			{ id: "personal-travel", name: "Travel" },
		],
	},
];

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
});
