import assert from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { buildMoveOptions, folderDelimiter } from "./move-options.js";

const englishBundle = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../../public/locales/en/mail.json", import.meta.url),
		),
		"utf8",
	),
) as { sidebar: Record<string, string> };

// The picker is handed the same shipped English bundle the app loads, so the
// expected labels are the product's own, not strings restated by the test.
const translate = (key: string, fallback: string): string =>
	englishBundle.sidebar[key.replace("sidebar.", "")] ?? fallback;

const make = (
	overrides: Partial<RemitImapMailboxResponse> & {
		mailboxId: string;
		fullPath: string;
	},
): RemitImapMailboxResponse =>
	({
		accountId: "acct-1",
		namespaceType: "personal",
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as RemitImapMailboxResponse;

const appoint = (
	role: RemitImapFolderAppointment["role"],
	mailboxId: string,
): RemitImapFolderAppointment => ({ role, source: "Appointed", mailboxId });

const applePaths = [
	make({ mailboxId: "mb-inbox", fullPath: "INBOX" }),
	make({ mailboxId: "mb-trash", fullPath: "INBOX/Deleted Messages" }),
	make({ mailboxId: "mb-junk", fullPath: "INBOX/Junk" }),
	make({ mailboxId: "mb-receipts", fullPath: "INBOX/Receipts" }),
];

const appleAppointments = [
	appoint("Inbox", "mb-inbox"),
	appoint("Trash", "mb-trash"),
	appoint("Junk", "mb-junk"),
];

const labelOf = (
	options: ReturnType<typeof buildMoveOptions>,
	id: string,
): string | undefined => options.find((option) => option.id === id)?.label;

describe("buildMoveOptions", () => {
	test("labels appointed folders by role, not by the provider's leaf", () => {
		const options = buildMoveOptions({
			mailboxes: applePaths,
			folderAppointments: appleAppointments,
			translator: translate,
		});
		assert.equal(labelOf(options, "mb-inbox"), "Inbox");
		assert.equal(labelOf(options, "mb-trash"), "Trash");
		assert.equal(labelOf(options, "mb-junk"), "Spam");
	});

	test("a displayNameOverride wins over the role label", () => {
		const options = buildMoveOptions({
			mailboxes: [
				make({
					mailboxId: "mb-trash",
					fullPath: "INBOX/Deleted Messages",
					displayNameOverride: "Bin",
				}),
			],
			folderAppointments: [appoint("Trash", "mb-trash")],
			translator: translate,
		});
		assert.equal(labelOf(options, "mb-trash"), "Bin");
	});

	test("an unappointed folder keeps its own name", () => {
		const options = buildMoveOptions({
			mailboxes: applePaths,
			folderAppointments: appleAppointments,
			translator: translate,
		});
		assert.equal(labelOf(options, "mb-receipts"), "Receipts");
	});

	test("a role label keeps the provider path it nests under", () => {
		const options = buildMoveOptions({
			mailboxes: applePaths,
			folderAppointments: appleAppointments,
			translator: translate,
		});
		const trash = options.find((option) => option.id === "mb-trash");
		assert.equal(trash?.label, "Trash");
		assert.equal(trash?.path, "INBOX/Deleted Messages");
	});

	test("the current mailbox is marked and nothing else is", () => {
		const options = buildMoveOptions({
			mailboxes: applePaths,
			folderAppointments: appleAppointments,
			currentMailboxId: "mb-junk",
			translator: translate,
		});
		assert.deepStrictEqual(
			options.filter((option) => option.isCurrent).map((option) => option.id),
			["mb-junk"],
		);
	});

	test("an excluded mailbox is not offered as a destination", () => {
		const options = buildMoveOptions({
			mailboxes: applePaths,
			folderAppointments: appleAppointments,
			excludeMailboxId: "mb-receipts",
			translator: translate,
		});
		assert.equal(
			options.some((option) => option.id === "mb-receipts"),
			false,
		);
	});
});

describe("folderDelimiter", () => {
	test("takes the account's own hierarchy separator", () => {
		assert.equal(
			folderDelimiter([
				make({ mailboxId: "mb-1", fullPath: "INBOX", hierarchyDelimiter: "." }),
			]),
			".",
		);
	});

	test("falls back to a slash when there are no mailboxes yet", () => {
		assert.equal(folderDelimiter([]), "/");
	});
});
