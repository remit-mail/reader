import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapFolderAppointment } from "@remit/api-http-client/types.gen.ts";
import {
	buildMailboxRoleMap,
	getMailboxDisplayName,
	labelForMailbox,
	shouldShowUnreadBadgeForRole,
} from "./folder-roles.js";

const appoint = (
	role: RemitImapFolderAppointment["role"],
	mailboxId: string | undefined,
): RemitImapFolderAppointment => ({ role, mailboxId });

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

describe("getMailboxDisplayName", () => {
	test("returns the leaf segment of a nested path", () => {
		assert.equal(getMailboxDisplayName("INBOX/Sent Messages"), "Sent Messages");
	});

	test("returns the whole path when there is no delimiter", () => {
		assert.equal(getMailboxDisplayName("INBOX"), "INBOX");
	});
});

describe("labelForMailbox", () => {
	const t = (key: string, fallback: string) =>
		key === "sidebar.sent" ? "Verzonden" : fallback;

	test("a trimmed displayNameOverride wins over everything", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX/Sent", displayNameOverride: "  My Sent  " },
				"sent",
				t,
			),
			"My Sent",
		);
	});

	test("falls back to the translated canonical role label", () => {
		assert.equal(
			labelForMailbox({ fullPath: "INBOX/Verzonden" }, "sent", t),
			"Verzonden",
		);
	});

	test("falls back to the provider leaf when there is no role", () => {
		assert.equal(
			labelForMailbox({ fullPath: "INBOX/Nieuwsbrieven" }, undefined, t),
			"Nieuwsbrieven",
		);
	});

	test("falls back to the leaf when no translator is supplied", () => {
		assert.equal(labelForMailbox({ fullPath: "INBOX/Sent" }, "sent"), "Sent");
	});

	test("a blank/whitespace override is ignored", () => {
		assert.equal(
			labelForMailbox(
				{ fullPath: "INBOX/Sent", displayNameOverride: "   " },
				"sent",
				t,
			),
			"Verzonden",
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
