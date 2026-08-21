import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type CandidateFolder,
	type RoleAppointment,
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

const appointed = (mailboxId: string): RoleAppointment => ({
	mailboxId,
	source: "Appointed",
});

function render(
	appointments: Record<string, RoleAppointment>,
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
		const html = render({ inbox: appointed("mb-inbox") });
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
		const html = render({ drafts: appointed("mb-concepten") });
		assert.match(html, /title="INBOX\/Concepten"/);
		assert.match(html, /340/);
		assert.match(html, /messages/);
	});

	it("renders a rename field only for an appointed role", () => {
		const html = render({ drafts: appointed("mb-concepten") });
		assert.match(html, /Display name for Drafts/);
		assert.doesNotMatch(html, /Display name for Sent/);
	});

	it("lists unappointed folders under Other folders", () => {
		const html = render({
			drafts: appointed("mb-concepten"),
			inbox: appointed("mb-inbox"),
		});
		assert.match(html, /Other folders/);
		assert.match(html, /Nieuwsbrieven/);
		assert.match(html, /Drafts/);
	});

	it("keeps an appointed folder out of the Other folders list", () => {
		const html = render({ drafts: appointed("mb-concepten") });
		const otherIdx = html.indexOf("Other folders");
		assert.ok(otherIdx >= 0);
		assert.doesNotMatch(html.slice(otherIdx), /Concepten/);
	});

	it("says where each answer came from, in front of the path", () => {
		assert.match(
			render({ drafts: appointed("mb-concepten") }),
			/Chosen by you · INBOX\/Concepten/,
		);
		assert.match(
			render({ drafts: { mailboxId: "mb-concepten", source: "Flagged" } }),
			/The mail server marks it as Drafts · INBOX\/Concepten/,
		);
		assert.match(
			render({ inbox: { mailboxId: "mb-inbox", source: "Reserved" } }),
			/The account&#x27;s own INBOX · INBOX/,
		);
		assert.match(
			render({ drafts: { mailboxId: "mb-concepten", source: "Proposed" } }),
			/Matched by name, not confirmed · INBOX\/Concepten/,
		);
	});

	it("announces the provenance with the control that changes it", () => {
		const html = render({ drafts: appointed("mb-concepten") });
		const described = /aria-describedby="([^"]+)"/.exec(html);
		assert.ok(described);
		assert.match(html, new RegExp(`id="${described[1]}"`));
	});

	it("reads an unfilled role as a decision waiting, not an error", () => {
		const html = render({ archive: { mailboxId: null, source: "None" } });
		assert.match(
			html,
			/Not set — pick the folder this account uses for Archive\.</,
		);
	});

	it("says only Trash gates a verb when it is unfilled", () => {
		const html = render({ trash: { mailboxId: null, source: "None" } });
		assert.match(html, /Deleting mail needs one\./);
	});

	it("calls out a stale Trash with the folder that vanished and its repair", () => {
		const html = render({
			trash: {
				mailboxId: null,
				source: "Stale",
				staleFolderPath: "INBOX/Prullenbak",
			},
		});
		assert.match(
			html,
			/The folder you chose for Trash — INBOX\/Prullenbak — is gone from the mail server\./,
		);
		assert.match(html, /Deleting mail is stopped until you pick another one\./);
		assert.match(html, /Pick a folder/);
		assert.match(html, /role="alert"/);
	});

	it("names what reader fell back to for a stale non-Trash role", () => {
		const html = render({
			drafts: {
				mailboxId: "mb-drafts",
				source: "Stale",
				staleFolderPath: "INBOX/Concepten",
			},
		});
		assert.match(
			html,
			/The folder you chose for Drafts — INBOX\/Concepten — is gone from the mail server\./,
		);
		assert.match(html, /reader is using Drafts instead\./);
		assert.doesNotMatch(html, /Deleting mail is stopped/);
	});

	it("drops the name clause when no path was ever recorded", () => {
		const html = render({ trash: { mailboxId: null, source: "Stale" } });
		assert.match(
			html,
			/The folder you chose for Trash is gone from the mail server\./,
		);
	});
});
