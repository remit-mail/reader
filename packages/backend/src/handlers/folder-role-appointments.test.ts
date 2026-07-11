import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountSettingItem } from "@remit/data-ports";
import { CanonicalMailboxRole, MailboxSpecialUse } from "@remit/domain-enums";
import {
	CANONICAL_ROLES,
	type FolderCandidate,
	findFolderForRole,
	groupFolderAppointmentsByAccount,
	loadFolderAppointmentsForAccount,
	resolveFolderAppointments,
	writeFolderRoleAppointment,
} from "./folder-role-appointments.js";

const setting = (name: string, value: string): AccountSettingItem =>
	({
		accountSettingId: `s-${name}`,
		accountConfigId: "cfg-1",
		name,
		value: { kind: "String", value },
		createdAt: 0,
		updatedAt: 0,
	}) as AccountSettingItem;

describe("CANONICAL_ROLES", () => {
	it("carries every RFC 032 anchor role, Custom excluded", () => {
		assert.deepEqual(
			[...CANONICAL_ROLES].sort(),
			[
				CanonicalMailboxRole.Inbox,
				CanonicalMailboxRole.Drafts,
				CanonicalMailboxRole.Sent,
				CanonicalMailboxRole.Archive,
				CanonicalMailboxRole.Junk,
				CanonicalMailboxRole.Trash,
				CanonicalMailboxRole.All,
				CanonicalMailboxRole.Flagged,
			].sort(),
		);
	});
});

describe("findFolderForRole", () => {
	const folders: FolderCandidate[] = [
		{ mailboxId: "mb-inbox", fullPath: "INBOX" },
		{
			mailboxId: "mb-drafts-empty",
			fullPath: "INBOX/Drafts",
			specialUse: [MailboxSpecialUse.Drafts],
		},
		{ mailboxId: "mb-concepten", fullPath: "INBOX/Concepten" },
		{ mailboxId: "mb-sent", fullPath: "INBOX/Sent" },
		{ mailboxId: "mb-sent-messages", fullPath: "INBOX/Sent Messages" },
		{ mailboxId: "mb-news", fullPath: "INBOX/Nieuwsbrieven" },
	];

	it("matches the reserved INBOX name for Inbox", () => {
		assert.equal(
			findFolderForRole(CanonicalMailboxRole.Inbox, folders),
			"mb-inbox",
		);
	});

	it("prefers the SPECIAL-USE flag over a name hint", () => {
		assert.equal(
			findFolderForRole(CanonicalMailboxRole.Drafts, folders),
			"mb-drafts-empty",
		);
	});

	it("falls back to a weak name hint when no flag is present", () => {
		assert.equal(
			findFolderForRole(CanonicalMailboxRole.Sent, folders),
			"mb-sent",
		);
	});

	it("returns null when nothing matches", () => {
		assert.equal(findFolderForRole(CanonicalMailboxRole.Junk, folders), null);
	});

	it("never matches a plain user folder", () => {
		assert.equal(
			findFolderForRole(CanonicalMailboxRole.Archive, folders),
			null,
		);
	});
});

describe("resolveFolderAppointments", () => {
	const folders: FolderCandidate[] = [
		{ mailboxId: "mb-inbox", fullPath: "INBOX" },
		{ mailboxId: "mb-concepten", fullPath: "INBOX/Concepten" },
		{
			mailboxId: "mb-spam",
			fullPath: "INBOX/Spam",
			specialUse: [MailboxSpecialUse.Junk],
		},
	];

	it("carries one entry per canonical role, even when unfilled", () => {
		const result = resolveFolderAppointments(new Map(), folders);
		assert.deepEqual(
			result.map((r) => r.role).sort(),
			[...CANONICAL_ROLES].sort(),
		);
	});

	it("prefers the persisted appointment over a fresh proposal", () => {
		const persisted = new Map([[CanonicalMailboxRole.Drafts, "mb-concepten"]]);
		const result = resolveFolderAppointments(persisted, folders);
		const drafts = result.find((r) => r.role === CanonicalMailboxRole.Drafts);
		assert.equal(drafts?.mailboxId, "mb-concepten");
	});

	it("re-proposes when the persisted mailbox no longer exists", () => {
		const persisted = new Map([
			[CanonicalMailboxRole.Junk, "mb-deleted-long-ago"],
		]);
		const result = resolveFolderAppointments(persisted, folders);
		const junk = result.find((r) => r.role === CanonicalMailboxRole.Junk);
		assert.equal(junk?.mailboxId, "mb-spam");
	});

	it("leaves a role unfilled when nothing persisted or proposed matches", () => {
		const result = resolveFolderAppointments(new Map(), folders);
		const archive = result.find((r) => r.role === CanonicalMailboxRole.Archive);
		assert.equal(archive?.mailboxId, undefined);
	});
});

describe("groupFolderAppointmentsByAccount", () => {
	it("groups by accountId then role from the composite setting name", () => {
		const settings = [
			setting(
				`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Drafts}`,
				"mb-1",
			),
			setting(
				`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Sent}`,
				"mb-2",
			),
			setting(
				`FolderRoleAppointment#acc-2#${CanonicalMailboxRole.Inbox}`,
				"mb-3",
			),
			setting("AccountDisplayName#acc-1", "Alice"),
		];
		const grouped = groupFolderAppointmentsByAccount(settings);
		assert.deepEqual(Object.fromEntries(grouped.get("acc-1") ?? []), {
			[CanonicalMailboxRole.Drafts]: "mb-1",
			[CanonicalMailboxRole.Sent]: "mb-2",
		});
		assert.deepEqual(Object.fromEntries(grouped.get("acc-2") ?? []), {
			[CanonicalMailboxRole.Inbox]: "mb-3",
		});
	});

	it("ignores a leftover MailboxRole#<mailboxId> row instead of throwing", () => {
		// The #963/#964 backfill wrote `MailboxRole#<mailboxId>` rows that are no
		// longer written but still persist in production. `FolderRoleAppointment`
		// superseded `MailboxRole` (RFC 032 exclusive-folder-appointment, #976);
		// a leftover row alongside real appointments must not make GET /config
		// throw — it is simply not a folder-role appointment and gets skipped.
		const settings = [
			setting(
				`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Drafts}`,
				"mb-1",
			),
			setting("MailboxRole#mb-legacy", "custom"),
		];
		const grouped = groupFolderAppointmentsByAccount(settings);
		assert.deepEqual(Object.fromEntries(grouped.get("acc-1") ?? []), {
			[CanonicalMailboxRole.Drafts]: "mb-1",
		});
	});
});

describe("loadFolderAppointmentsForAccount", () => {
	it("reads each role's row and collects only the ones that exist", async () => {
		const stored = new Map<string, string>([
			[`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Sent}`, "mb-sent"],
		]);
		const accountSetting = {
			get: async (_accountConfigId: string, name: string) => {
				const value = stored.get(name);
				return value ? setting(name, value) : null;
			},
		};
		const roles = await loadFolderAppointmentsForAccount(
			accountSetting,
			"cfg-1",
			"acc-1",
		);
		assert.deepEqual(Object.fromEntries(roles), {
			[CanonicalMailboxRole.Sent]: "mb-sent",
		});
	});
});

describe("writeFolderRoleAppointment", () => {
	it("upserts a String-valued row for a value", async () => {
		const calls: unknown[] = [];
		const accountSetting = {
			upsert: async (input: unknown) => {
				calls.push(input);
				return input as never;
			},
			delete: async () => {
				throw new Error("should not delete");
			},
		};
		await writeFolderRoleAppointment(
			accountSetting,
			"cfg-1",
			"acc-1",
			CanonicalMailboxRole.Archive,
			"mb-archive",
		);
		assert.deepEqual(calls, [
			{
				accountConfigId: "cfg-1",
				name: `FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Archive}`,
				value: { kind: "String", value: "mb-archive" },
			},
		]);
	});

	it("deletes the row when mailboxId is null (clear)", async () => {
		const calls: unknown[][] = [];
		const accountSetting = {
			upsert: async () => {
				throw new Error("should not upsert");
			},
			delete: async (accountConfigId: string, name: string) => {
				calls.push([accountConfigId, name]);
			},
		};
		await writeFolderRoleAppointment(
			accountSetting,
			"cfg-1",
			"acc-1",
			CanonicalMailboxRole.Archive,
			null,
		);
		assert.deepEqual(calls, [
			["cfg-1", `FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Archive}`],
		]);
	});
});
