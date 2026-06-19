import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	getPresetById,
	PROVIDER_PRESETS,
	type ProviderPreset,
	presetIdForEmail,
} from "./provider-presets.js";

interface ExpectedSettings {
	imap: { host: string; port: number; security: string };
	smtp: { host: string; port: number; security: string };
}

const EXPECTED: Record<string, ExpectedSettings> = {
	icloud: {
		imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
	},
	yahoo: {
		imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
	},
	aol: {
		imap: { host: "imap.aol.com", port: 993, security: "tls" },
		smtp: { host: "smtp.aol.com", port: 465, security: "tls" },
	},
	fastmail: {
		imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
	},
};

describe("provider presets", () => {
	it("exposes exactly the four documented providers", () => {
		const ids = PROVIDER_PRESETS.map((p) => p.id).sort();
		assert.deepEqual(ids, ["aol", "fastmail", "icloud", "yahoo"]);
	});

	for (const preset of PROVIDER_PRESETS) {
		describe(preset.label, () => {
			const expected = EXPECTED[preset.id];

			it("matches the exact IMAP settings from the table", () => {
				assert.deepEqual(preset.imap, expected.imap);
			});

			it("matches the exact SMTP settings from the table", () => {
				assert.deepEqual(preset.smtp, expected.smtp);
			});

			it("uses the full email as username", () => {
				assert.equal(preset.username, "full-email");
			});

			it("has password help text", () => {
				assert.ok(preset.passwordHelp.text.length > 0);
				assert.match(preset.passwordHelp.text, /app[\w-]* password/i);
			});

			it("has a valid https app-password url", () => {
				const url = new URL(preset.passwordHelp.url);
				assert.equal(url.protocol, "https:");
			});
		});
	}

	it("looks up a preset by id", () => {
		const preset: ProviderPreset | undefined = getPresetById("icloud");
		assert.ok(preset);
		assert.equal(preset.label, "iCloud");
	});

	it("returns undefined for an unknown id", () => {
		assert.equal(getPresetById("custom"), undefined);
	});

	describe("presetIdForEmail", () => {
		it("pre-selects a preset for a known provider domain", () => {
			assert.equal(presetIdForEmail("alice@icloud.com"), "icloud");
			assert.equal(presetIdForEmail("bob@me.com"), "icloud");
			assert.equal(presetIdForEmail("carol@yahoo.com"), "yahoo");
			assert.equal(presetIdForEmail("dave@aol.com"), "aol");
			assert.equal(presetIdForEmail("erin@fastmail.com"), "fastmail");
		});

		it("is case-insensitive on the domain", () => {
			assert.equal(presetIdForEmail("Alice@iCloud.com"), "icloud");
		});

		it("returns Custom for unknown or malformed addresses", () => {
			assert.equal(presetIdForEmail("self@example.com"), "");
			assert.equal(presetIdForEmail("not-an-email"), "");
		});
	});
});
