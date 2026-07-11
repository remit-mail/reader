import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type CandidateFolder,
	RoleAppointmentList,
} from "./role-appointment-list.js";

const noop = () => {};

const folders: CandidateFolder[] = [
	{ mailboxId: "mb-inbox", providerPath: "INBOX", messageCount: 4821 },
	{
		mailboxId: "mb-concepten",
		providerPath: "INBOX/Concepten",
		messageCount: 340,
	},
	{ mailboxId: "mb-drafts", providerPath: "INBOX/Drafts", messageCount: 0 },
	{
		mailboxId: "mb-news",
		providerPath: "INBOX/Nieuwsbrieven",
		messageCount: 2870,
	},
];

function render(
	appointments: Record<string, string | null>,
	displayNames: Record<string, string> = {},
): string {
	return renderToString(
		createElement(RoleAppointmentList, {
			accountEmail: "you@example.com",
			folders,
			appointments,
			displayNames,
			onAppoint: noop,
			onRename: noop,
		}),
	);
}

describe("RoleAppointmentList", () => {
	it("titles the section with the account email", () => {
		const html = render({ inbox: "mb-inbox" });
		assert.match(html, /Folder roles —/);
		assert.match(html, /you@example.com/);
	});

	it("renders a row for every appointable role", () => {
		const html = render({});
		for (const label of [
			"Inbox",
			"Drafts",
			"Sent",
			"Archive",
			"Spam",
			"Trash",
		]) {
			assert.match(html, new RegExp(`Folder for ${label}`));
		}
	});

	it("offers every folder with its message count as a picker option", () => {
		const html = render({});
		assert.match(html, /Concepten · 340 msgs/);
		assert.match(html, /Drafts · 0 msgs/);
		assert.match(html, /None/);
	});

	it("shows the appointed folder's path and count under the role", () => {
		const html = render({ drafts: "mb-concepten" });
		assert.match(html, /title="INBOX\/Concepten"/);
		assert.match(html, /340/);
		assert.match(html, /messages/);
	});

	it("renders a rename field only for an appointed role", () => {
		const html = render({ drafts: "mb-concepten" });
		assert.match(html, /Display name for Drafts/);
		assert.doesNotMatch(html, /Display name for Sent/);
	});

	it("lists unappointed folders under Other folders", () => {
		const html = render({ drafts: "mb-concepten", inbox: "mb-inbox" });
		assert.match(html, /Other folders/);
		assert.match(html, /Nieuwsbrieven/);
		assert.match(html, /Drafts/);
	});

	it("keeps an appointed folder out of the Other folders list", () => {
		const html = render({ drafts: "mb-concepten" });
		const otherIdx = html.indexOf("Other folders");
		assert.ok(otherIdx >= 0);
		assert.doesNotMatch(html.slice(otherIdx), /Concepten/);
	});
});
