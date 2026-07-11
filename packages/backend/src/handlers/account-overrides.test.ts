import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountSettingItem } from "@remit/data-ports";
import {
	groupAccountOverrides,
	groupMailboxOverrides,
} from "./account-overrides.js";

const setting = (
	name: string,
	value: AccountSettingItem["value"],
): AccountSettingItem =>
	({
		accountSettingId: `s-${name}`,
		accountConfigId: "cfg-1",
		name,
		value,
		createdAt: 0,
		updatedAt: 0,
	}) as AccountSettingItem;

const stringSetting = (name: string, value: string): AccountSettingItem =>
	setting(name, { kind: "String", value });

describe("groupAccountOverrides", () => {
	it("groups displayName and muted overrides by accountId", () => {
		const settings = [
			stringSetting("AccountDisplayName#acc-1", "Alice"),
			stringSetting("AccountDisplayName#acc-2", "Bob"),
		];
		const grouped = groupAccountOverrides(settings);
		assert.equal(grouped.get("acc-1")?.displayName, "Alice");
		assert.equal(grouped.get("acc-2")?.displayName, "Bob");
	});

	it("ignores a leftover MailboxRole#<mailboxId> row instead of throwing", () => {
		// Leftover rows from the #963/#964 backfill (superseded by
		// FolderRoleAppointment, RFC 032 exclusive-folder-appointment #976) must
		// not make GET /config throw — groupAccountOverrides only reacts to
		// AccountDisplayName/AccountMuted bases, so this row is simply skipped.
		const settings = [
			stringSetting("AccountDisplayName#acc-1", "Alice"),
			stringSetting("MailboxRole#mb-legacy", "custom"),
		];
		assert.doesNotThrow(() => groupAccountOverrides(settings));
		const grouped = groupAccountOverrides(settings);
		assert.equal(grouped.get("acc-1")?.displayName, "Alice");
		assert.equal(grouped.size, 1);
	});
});

describe("groupMailboxOverrides", () => {
	it("groups displayNameOverride and muted overrides by mailboxId", () => {
		const settings = [stringSetting("MailboxDisplayName#mb-1", "Work")];
		const grouped = groupMailboxOverrides(settings);
		assert.equal(grouped.get("mb-1")?.displayNameOverride, "Work");
	});

	it("ignores a leftover MailboxRole#<mailboxId> row instead of throwing", () => {
		const settings = [
			stringSetting("MailboxDisplayName#mb-1", "Work"),
			stringSetting("MailboxRole#mb-legacy", "custom"),
		];
		assert.doesNotThrow(() => groupMailboxOverrides(settings));
		const grouped = groupMailboxOverrides(settings);
		assert.equal(grouped.get("mb-1")?.displayNameOverride, "Work");
		assert.equal(grouped.size, 1);
	});
});
