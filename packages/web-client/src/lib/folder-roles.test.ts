import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapFolderAppointment } from "@remit/api-http-client/types.gen.ts";
import {
	buildMailboxRoleMap,
	labelForMailbox,
	shouldShowUnreadBadgeForRole,
} from "./folder-roles.js";

const appoint = (
	role: RemitImapFolderAppointment["role"],
	mailboxId: string | undefined,
): RemitImapFolderAppointment => ({ role, source: "Appointed", mailboxId });

describe("buildMailboxRoleMap", () => {
	test("maps mailboxId to its appointed role", () => {
		const map = buildMailboxRoleMap([
			appoint("Inbox", "mb-inbox"),
			appoint("Drafts", "mb-concepten"),
		]);
		assert.equal(map.get("mb-inbox"), "inbox");
		assert.equal(map.get("mb-concepten"), "drafts");
	});

	test("an unfilled role (no mailboxId) contributes no entry", () => {
		const map = buildMailboxRoleMap([appoint("Archive", undefined)]);
		assert.equal(map.size, 0);
	});

	test("a mailbox appointed to two roles keeps the higher-priority one", () => {
		// RFC 032: a folder may legitimately fill more than one role — the
		// sidebar shows one row, so the map picks a single winner deterministically.
		const map = buildMailboxRoleMap([
			appoint("Trash", "mb-1"),
			appoint("Inbox", "mb-1"),
		]);
		assert.equal(map.get("mb-1"), "inbox");
	});

	test("empty appointments produce an empty map", () => {
		assert.equal(buildMailboxRoleMap([]).size, 0);
	});
});

describe("labelForMailbox", () => {
	const t = (key: string, fallback: string) =>
		key === "sidebar.sent" ? "Verzonden" : fallback;

	test("a trimmed displayNameOverride wins over everything", () => {
		assert.equal(
			labelForMailbox(
				{
					fullPath: "INBOX/Sent",
					hierarchyDelimiter: "/",
					displayNameOverride: "  My Sent  ",
				},
				"sent",
				t,
			),
			"My Sent",
		);
	});

	test("falls back to the translated canonical role label", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX/Verzonden", hierarchyDelimiter: "/" },
				"sent",
				t,
			),
			"Verzonden",
		);
	});

	test("falls back to the provider leaf when there is no role", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX/Nieuwsbrieven", hierarchyDelimiter: "/" },
				undefined,
				t,
			),
			"Nieuwsbrieven",
		);
	});

	test("falls back to the leaf when no translator is supplied", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX/Sent", hierarchyDelimiter: "/" },
				"sent",
			),
			"Sent",
		);
	});

	test("a blank/whitespace override is ignored", () => {
		assert.equal(
			labelForMailbox(
				{
					fullPath: "INBOX/Sent",
					hierarchyDelimiter: "/",
					displayNameOverride: "   ",
				},
				"sent",
				t,
			),
			"Verzonden",
		);
	});
});

describe("labelForMailbox — the server’s own delimiter (#877)", () => {
	test("a dot-delimited nested folder renders its leaf", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX.Projects.Q3", hierarchyDelimiter: "." },
				undefined,
			),
			"Q3",
		);
	});

	test("a flat namespace renders the whole name", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "Projects/Q3", hierarchyDelimiter: "" },
				undefined,
			),
			"Projects/Q3",
		);
	});

	test("a slash in a dot-delimited name is part of the name", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX.Reading/Writing", hierarchyDelimiter: "." },
				undefined,
			),
			"Reading/Writing",
		);
	});
});

describe("shouldShowUnreadBadgeForRole", () => {
	test("hides the badge for Sent, Drafts, and Trash", () => {
		assert.equal(shouldShowUnreadBadgeForRole("sent"), false);
		assert.equal(shouldShowUnreadBadgeForRole("drafts"), false);
		assert.equal(shouldShowUnreadBadgeForRole("trash"), false);
	});

	test("shows the badge for Inbox, Junk, and plain folders (no role)", () => {
		assert.equal(shouldShowUnreadBadgeForRole("inbox"), true);
		assert.equal(shouldShowUnreadBadgeForRole("junk"), true);
		assert.equal(shouldShowUnreadBadgeForRole(undefined), true);
	});
});
