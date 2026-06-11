import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/remit-electrodb-service";
import {
	type EncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { resolveSmtpConfig } from "./resolve-smtp-config.js";

const buildAccount = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acct-1",
		accountConfigId: "cfg-1",
		username: "alice@example.com",
		email: "alice@example.com",
		passwordHash: JSON.stringify(
			serializeEncryptedPayload({
				encryptedDek: Buffer.from("dek-imap"),
				encryptedData: Buffer.from("data-imap"),
				iv: Buffer.from("iv-imap"),
				authTag: Buffer.from("tag-imap"),
			}),
		),
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as unknown as AccountItem;

const stubSecrets = (calls: EncryptedPayload[]) => ({
	decrypt: async (payload: EncryptedPayload): Promise<string> => {
		calls.push(payload);
		return payload.encryptedDek.toString();
	},
});

describe("resolveSmtpConfig", () => {
	it("returns missing when smtpHost is absent", async () => {
		const result = await resolveSmtpConfig(
			buildAccount({ smtpHost: undefined, smtpPort: 587 }),
			stubSecrets([]),
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.reason, /SMTP not configured/);
	});

	it("returns missing when smtpPort is absent", async () => {
		const result = await resolveSmtpConfig(
			buildAccount({ smtpHost: "smtp.example.com", smtpPort: undefined }),
			stubSecrets([]),
		);
		assert.equal(result.ok, false);
	});

	it("falls back to IMAP password when smtpPasswordHash is absent (issue #163)", async () => {
		// This is the regression: the web form does not send smtpPassword
		// unless "use different credentials for SMTP" is checked, so accounts
		// that share credentials between IMAP and SMTP have no
		// smtpPasswordHash. Without the fallback, every send fails with
		// "SMTP not configured".
		const calls: EncryptedPayload[] = [];
		const account = buildAccount({
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpPasswordHash: undefined,
		});
		const result = await resolveSmtpConfig(account, stubSecrets(calls));

		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(calls.length, 1);
		assert.equal(
			calls[0].encryptedDek.toString(),
			"dek-imap",
			"should decrypt the IMAP passwordHash",
		);
		assert.equal(result.config.host, "smtp.example.com");
		assert.equal(result.config.port, 587);
		assert.equal(result.config.user, "alice@example.com");
		assert.equal(result.config.credentials.kind, "password");
		if (result.config.credentials.kind === "password") {
			assert.equal(result.config.credentials.password, "dek-imap");
		}
	});

	it("uses smtpPasswordHash when present, not the IMAP passwordHash", async () => {
		const calls: EncryptedPayload[] = [];
		const smtpPasswordHash = JSON.stringify(
			serializeEncryptedPayload({
				encryptedDek: Buffer.from("dek-smtp"),
				encryptedData: Buffer.from("data-smtp"),
				iv: Buffer.from("iv-smtp"),
				authTag: Buffer.from("tag-smtp"),
			}),
		);
		const account = buildAccount({
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpUsername: "alice-smtp@example.com",
			smtpPasswordHash,
		});
		const result = await resolveSmtpConfig(account, stubSecrets(calls));

		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(calls.length, 1);
		assert.equal(calls[0].encryptedDek.toString(), "dek-smtp");
		assert.equal(result.config.user, "alice-smtp@example.com");
		assert.equal(result.config.credentials.kind, "password");
		if (result.config.credentials.kind === "password") {
			assert.equal(result.config.credentials.password, "dek-smtp");
		}
	});

	it("uses smtpTls flag for the secure setting", async () => {
		const result = await resolveSmtpConfig(
			buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 465,
				smtpTls: true,
			}),
			stubSecrets([]),
		);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.config.secure, true);
	});

	it("defaults secure to false when smtpTls is absent", async () => {
		const result = await resolveSmtpConfig(
			buildAccount({
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				smtpTls: undefined,
			}),
			stubSecrets([]),
		);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.config.secure, false);
	});
});
