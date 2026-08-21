import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AccountSettingItem } from "@remit/data-ports";
import type { RoleMailboxCandidate } from "@remit/data-ports/folder-role";
import {
	CanonicalMailboxRole,
	FolderAppointmentSource,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	CANONICAL_ROLES,
	groupFolderAppointmentsByAccount,
	loadFolderAppointmentsForAccount,
	type PersistedFolderAppointment,
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

const appointed = (
	mailboxId: string,
	lastKnownPath?: string,
): Map<string, PersistedFolderAppointment> =>
	new Map([[CanonicalMailboxRole.Trash, { mailboxId, lastKnownPath }]]);

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

describe("resolveFolderAppointments", () => {
	const folders: RoleMailboxCandidate[] = [
		{ mailboxId: "mb-inbox", fullPath: "INBOX", hierarchyDelimiter: "/" },
		{
			mailboxId: "mb-concepten",
			fullPath: "INBOX/Concepten",
			hierarchyDelimiter: "/",
		},
		{
			mailboxId: "mb-spam",
			fullPath: "INBOX/Spam",
			hierarchyDelimiter: "/",
			specialUse: [MailboxSpecialUse.Junk],
		},
	];

	const roleIn = (
		result: ReturnType<typeof resolveFolderAppointments>,
		role: string,
	) => result.find((entry) => entry.role === role);

	it("carries one entry per canonical role, even when unfilled", () => {
		const result = resolveFolderAppointments(new Map(), folders);
		assert.deepEqual(
			result.map((r) => r.role).sort(),
			[...CANONICAL_ROLES].sort(),
		);
	});

	it("gives every role a source, so no surface has to infer one", () => {
		const result = resolveFolderAppointments(new Map(), folders);
		assert.equal(
			result.every((entry) => entry.source !== undefined),
			true,
		);
	});

	it("tells a folder the user chose from one reader guessed by name", () => {
		const persisted = new Map<string, PersistedFolderAppointment>([
			[CanonicalMailboxRole.Drafts, { mailboxId: "mb-concepten" }],
		]);
		const result = resolveFolderAppointments(persisted, folders);
		const drafts = roleIn(result, CanonicalMailboxRole.Drafts);
		assert.equal(drafts?.mailboxId, "mb-concepten");
		assert.equal(drafts?.source, FolderAppointmentSource.Appointed);

		const proposed = resolveFolderAppointments(new Map(), folders);
		const guess = roleIn(proposed, CanonicalMailboxRole.Drafts);
		assert.equal(guess?.mailboxId, "mb-concepten");
		assert.equal(guess?.source, FolderAppointmentSource.Proposed);
	});

	it("marks the server's own flag and the reserved INBOX name as such", () => {
		const result = resolveFolderAppointments(new Map(), folders);
		assert.equal(
			roleIn(result, CanonicalMailboxRole.Junk)?.source,
			FolderAppointmentSource.Flagged,
		);
		assert.equal(
			roleIn(result, CanonicalMailboxRole.Inbox)?.source,
			FolderAppointmentSource.Reserved,
		);
	});

	it("surfaces a choice whose folder is gone as broken, not as absent", () => {
		const persisted = new Map<string, PersistedFolderAppointment>([
			[
				CanonicalMailboxRole.Junk,
				{ mailboxId: "mb-deleted-long-ago", lastKnownPath: "INBOX/Rommel" },
			],
		]);
		const junk = roleIn(
			resolveFolderAppointments(persisted, folders),
			CanonicalMailboxRole.Junk,
		);
		assert.equal(junk?.source, FolderAppointmentSource.Stale);
		assert.equal(junk?.staleAppointmentMailboxId, "mb-deleted-long-ago");
		assert.equal(junk?.staleAppointmentPath, "INBOX/Rommel");
		assert.equal(junk?.mailboxId, "mb-spam");
	});

	it("leaves a role unfilled when nothing persisted or proposed matches", () => {
		const archive = roleIn(
			resolveFolderAppointments(new Map(), folders),
			CanonicalMailboxRole.Archive,
		);
		assert.equal(archive?.mailboxId, undefined);
		assert.equal(archive?.source, FolderAppointmentSource.None);
	});

	it("never reads the recorded path as evidence for the role", () => {
		const trash = roleIn(
			resolveFolderAppointments(appointed("mb-inbox", "Prullenbak"), folders),
			CanonicalMailboxRole.Trash,
		);
		assert.equal(trash?.mailboxId, "mb-inbox");
		assert.equal(trash?.staleAppointmentPath, undefined);
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
			[CanonicalMailboxRole.Drafts]: { mailboxId: "mb-1" },
			[CanonicalMailboxRole.Sent]: { mailboxId: "mb-2" },
		});
		assert.deepEqual(Object.fromEntries(grouped.get("acc-2") ?? []), {
			[CanonicalMailboxRole.Inbox]: { mailboxId: "mb-3" },
		});
	});

	it("attaches the recorded path to the appointment it belongs to", () => {
		const settings = [
			setting(
				`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Trash}`,
				"mb-1",
			),
			setting(
				`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Trash}`,
				"INBOX/Bak",
			),
			setting(
				`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Sent}`,
				"INBOX/Verzonden",
			),
		];
		const grouped = groupFolderAppointmentsByAccount(settings);
		assert.deepEqual(Object.fromEntries(grouped.get("acc-1") ?? []), {
			[CanonicalMailboxRole.Trash]: {
				mailboxId: "mb-1",
				lastKnownPath: "INBOX/Bak",
			},
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
			[CanonicalMailboxRole.Drafts]: { mailboxId: "mb-1" },
		});
	});
});

describe("loadFolderAppointmentsForAccount", () => {
	const readerOver = (stored: Map<string, string>) => ({
		get: async (_accountConfigId: string, name: string) => {
			const value = stored.get(name);
			return value ? setting(name, value) : null;
		},
	});

	it("reads each role's row and collects only the ones that exist", async () => {
		const roles = await loadFolderAppointmentsForAccount(
			readerOver(
				new Map([
					[
						`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Sent}`,
						"mb-sent",
					],
				]),
			),
			"cfg-1",
			"acc-1",
		);
		assert.deepEqual(Object.fromEntries(roles), {
			[CanonicalMailboxRole.Sent]: { mailboxId: "mb-sent" },
		});
	});

	it("picks up the recorded path beside the appointment", async () => {
		const roles = await loadFolderAppointmentsForAccount(
			readerOver(
				new Map([
					[
						`FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Trash}`,
						"mb-bak",
					],
					[
						`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Trash}`,
						"INBOX/Bak",
					],
				]),
			),
			"cfg-1",
			"acc-1",
		);
		assert.deepEqual(roles.get(CanonicalMailboxRole.Trash), {
			mailboxId: "mb-bak",
			lastKnownPath: "INBOX/Bak",
		});
	});

	it("drops a label left behind by an appointment that was cleared", async () => {
		const roles = await loadFolderAppointmentsForAccount(
			readerOver(
				new Map([
					[
						`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Trash}`,
						"INBOX/Bak",
					],
				]),
			),
			"cfg-1",
			"acc-1",
		);
		assert.equal(roles.get(CanonicalMailboxRole.Trash), undefined);
	});
});

describe("writeFolderRoleAppointment", () => {
	const recorder = () => {
		const upserts: unknown[] = [];
		const deletes: unknown[][] = [];
		return {
			upserts,
			deletes,
			accountSetting: {
				upsert: async (input: unknown) => {
					upserts.push(input);
					return input as never;
				},
				delete: async (accountConfigId: string, name: string) => {
					deletes.push([accountConfigId, name]);
				},
			},
		};
	};

	it("records the path alongside the appointment", async () => {
		const { upserts, deletes, accountSetting } = recorder();
		await writeFolderRoleAppointment(
			accountSetting,
			"cfg-1",
			"acc-1",
			CanonicalMailboxRole.Archive,
			"mb-archive",
			"INBOX/Archief",
		);
		assert.deepEqual(upserts, [
			{
				accountConfigId: "cfg-1",
				name: `FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Archive}`,
				value: { kind: "String", value: "mb-archive" },
			},
			{
				accountConfigId: "cfg-1",
				name: `FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Archive}`,
				value: { kind: "String", value: "INBOX/Archief" },
			},
		]);
		assert.deepEqual(deletes, []);
	});

	it("clears a path left over from the previous choice", async () => {
		const { upserts, deletes, accountSetting } = recorder();
		await writeFolderRoleAppointment(
			accountSetting,
			"cfg-1",
			"acc-1",
			CanonicalMailboxRole.Archive,
			"mb-archive",
		);
		assert.equal(upserts.length, 1);
		assert.deepEqual(deletes, [
			[
				"cfg-1",
				`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Archive}`,
			],
		]);
	});

	it("deletes both rows when the appointment is cleared", async () => {
		const { upserts, deletes, accountSetting } = recorder();
		await writeFolderRoleAppointment(
			accountSetting,
			"cfg-1",
			"acc-1",
			CanonicalMailboxRole.Archive,
			null,
		);
		assert.deepEqual(upserts, []);
		assert.deepEqual(deletes, [
			["cfg-1", `FolderRoleAppointment#acc-1#${CanonicalMailboxRole.Archive}`],
			[
				"cfg-1",
				`FolderRoleAppointmentLabel#acc-1#${CanonicalMailboxRole.Archive}`,
			],
		]);
	});
});

/**
 * D1 of the #887 design: a folder-role appointment row means one thing — a
 * person decided. That is what makes an appointment outrank the server's own
 * \Trash flag, and what makes an Empty Trash on one defensible. It holds only
 * while the row has a single author, so the author is pinned here rather than
 * left to review.
 */
describe("who may write a folder-role appointment", () => {
	const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));

	const sourceFiles = (): string[] => {
		const files: string[] = [];
		for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
			if (!pkg.isDirectory()) continue;
			const src = join(PACKAGES, pkg.name, "src");
			if (!existsSync(src)) continue;
			for (const entry of readdirSync(src, { recursive: true })) {
				const name = String(entry);
				if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
				if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
				files.push(`${pkg.name}/src/${name}`);
			}
		}
		return files;
	};

	it("is composed in three places, and nowhere else in the repo", () => {
		const referrers = sourceFiles().filter((file) =>
			readFileSync(join(PACKAGES, file), "utf8").includes(
				"composeFolderRoleAppointmentName",
			),
		);
		assert.deepEqual(referrers.sort(), [
			"backend/src/handlers/folder-role-appointments.ts",
			"data-ports/src/folder-role.ts",
			"drizzle-service/src/repos/i4-mailbox-special-use.ts",
		]);
	});

	it("is written by writeFolderRoleAppointment alone", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./folder-role-appointments.ts", import.meta.url)),
			"utf8",
		);
		const writer = source.slice(
			source.indexOf("export const writeFolderRoleAppointment"),
		);
		const body = writer.slice(0, writer.indexOf("\n};"));

		const count = (text: string, needle: string) =>
			text.split(needle).length - 1;
		// Without these, renaming the receiver satisfies the guard with 0 === 0.
		assert.ok(count(body, "accountSetting.upsert(") > 0);
		assert.ok(count(body, "accountSetting.delete(") > 0);
		assert.equal(
			count(source, "accountSetting.upsert("),
			count(body, "accountSetting.upsert("),
		);
		assert.equal(
			count(source, "accountSetting.delete("),
			count(body, "accountSetting.delete("),
		);
	});
});
