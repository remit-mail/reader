import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APP_PASSWORD_URLS, discoverSettings } from "./autodiscovery.js";
import { getPresetById, presetIdForEmail } from "./provider-presets.js";

describe("provider presets", () => {
	it("tells a Gmail user to turn on 2-Step Verification before creating an app password", () => {
		const gmail = getPresetById("gmail");
		assert.ok(gmail);
		const { text, url } = gmail.passwordHelp;
		const twoStep = text.search(/2-Step Verification/);
		const appPassword = text.search(/create an app password/i);
		assert.ok(twoStep >= 0, "names 2-Step Verification");
		assert.ok(appPassword > twoStep, "2-Step Verification comes first");
		assert.equal(url, APP_PASSWORD_URLS["gmail.com"]);
		assert.equal(url, APP_PASSWORD_URLS["googlemail.com"]);
	});

	describe("presetIdForEmail", () => {
		it("pre-selects a preset for a known provider domain", () => {
			assert.equal(presetIdForEmail("alice@icloud.com"), "icloud");
			assert.equal(presetIdForEmail("bob@me.com"), "icloud");
			assert.equal(presetIdForEmail("carol@yahoo.com"), "yahoo");
			assert.equal(presetIdForEmail("dave@aol.com"), "aol");
			assert.equal(presetIdForEmail("erin@fastmail.com"), "fastmail");
			assert.equal(presetIdForEmail("frank@gmail.com"), "gmail");
			assert.equal(presetIdForEmail("grace@googlemail.com"), "gmail");
		});

		it("resolves a Gmail address to the preset its server lookup agrees with", async () => {
			for (const email of ["user@gmail.com", "User@GoogleMail.com"]) {
				const preset = getPresetById(presetIdForEmail(email));
				assert.ok(preset, email);
				assert.equal(preset.id, "gmail");
				const discovered = await discoverSettings(email);
				assert.ok(discovered, email);
				assert.deepEqual(preset.imap, discovered.imap);
				assert.deepEqual(preset.smtp, discovered.smtp);
			}
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
