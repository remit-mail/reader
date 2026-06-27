import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { MailboxRole, MailboxSpecialUse } from "@remit/domain-enums";
import {
	buildCommitBody,
	buildFolderDescriptors,
	buildResetBody,
	folderRoleToMailboxRole,
	toFolderDescriptor,
} from "./folder-names.js";

const mailbox = (
	over: Partial<Omit<RemitImapMailboxResponse, "specialUse">> & {
		mailboxId: string;
		fullPath: string;
		// `MailboxSpecialUse.*` resolves to the bare runtime value (e.g. "Sent")
		// while the OpenAPI type is the RFC literal ("\\Sent"); detection accepts
		// either, mirroring `mailbox-order`.
		specialUse?: readonly string[];
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
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...over,
	}) as RemitImapMailboxResponse;

describe("toFolderDescriptor", () => {
	test("detects role from special-use and shows placeholder when no override", () => {
		const d = toFolderDescriptor(
			mailbox({
				mailboxId: "m1",
				fullPath: "INBOX/Sent",
				specialUse: [MailboxSpecialUse.Sent],
			}),
		);
		assert.deepStrictEqual(d, {
			id: "m1",
			providerPath: "INBOX/Sent",
			detectedRole: "sent",
			role: "sent",
			name: "",
		});
	});

	test("shows the display-name override when present", () => {
		const d = toFolderDescriptor(
			mailbox({
				mailboxId: "m2",
				fullPath: "INBOX",
				displayNameOverride: "Primary",
			}),
		);
		assert.strictEqual(d.name, "Primary");
		assert.strictEqual(d.detectedRole, "inbox");
		assert.strictEqual(d.role, "inbox");
	});

	test("role override wins over the detected role", () => {
		const d = toFolderDescriptor(
			mailbox({
				mailboxId: "m3",
				fullPath: "INBOX/Newsletters",
				roleOverride: MailboxRole.Archive,
			}),
		);
		assert.strictEqual(d.detectedRole, "custom");
		assert.strictEqual(d.role, "archive");
	});

	test("plain user folder detects as custom", () => {
		const d = toFolderDescriptor(
			mailbox({ mailboxId: "m4", fullPath: "INBOX/Projects" }),
		);
		assert.strictEqual(d.detectedRole, "custom");
		assert.strictEqual(d.role, "custom");
	});
});

describe("buildFolderDescriptors", () => {
	test("maps every mailbox (the kit filters custom rows itself)", () => {
		const rows = buildFolderDescriptors([
			mailbox({ mailboxId: "m1", fullPath: "INBOX" }),
			mailbox({ mailboxId: "m2", fullPath: "INBOX/Projects" }),
		]);
		assert.strictEqual(rows.length, 2);
		assert.deepStrictEqual(
			rows.map((r) => r.id),
			["m1", "m2"],
		);
	});
});

describe("folderRoleToMailboxRole", () => {
	test("maps lowercase kit roles to PascalCase enum values", () => {
		assert.strictEqual(folderRoleToMailboxRole("junk"), MailboxRole.Junk);
		assert.strictEqual(folderRoleToMailboxRole("custom"), MailboxRole.Custom);
	});
});

describe("buildCommitBody", () => {
	test("sets the trimmed name and the mapped role", () => {
		assert.deepStrictEqual(
			buildCommitBody({ role: "junk", name: "  Spam  " }),
			{
				displayNameOverride: "Spam",
				roleOverride: MailboxRole.Junk,
			},
		);
	});

	test("an empty name clears the display-name override", () => {
		assert.deepStrictEqual(buildCommitBody({ role: "sent", name: "   " }), {
			displayNameOverride: null,
			roleOverride: MailboxRole.Sent,
		});
	});
});

describe("buildResetBody", () => {
	test("clears both overrides", () => {
		assert.deepStrictEqual(buildResetBody(), {
			displayNameOverride: null,
			roleOverride: null,
		});
	});
});
