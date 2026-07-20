import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpdateManifestSchema } from "./update-manifest.js";

const GOOD_MANIFEST = {
	version: "v1.5.0",
	publishedAt: "2026-07-18T09:00:00Z",
	summary: "Faster search and a fix for attachments over 25 MB.",
	releaseNotesUrl: "https://github.com/remit-mail/reader/releases/tag/v1.5.0",
	registry: "ghcr.io/remit-mail/reader",
};

describe("UpdateManifestSchema", () => {
	it("accepts the documented manifest shape", () => {
		assert.deepEqual(UpdateManifestSchema.parse(GOOD_MANIFEST), GOOD_MANIFEST);
	});

	it("rejects a version that is not vX.Y.Z", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, version: "1.5.0" }),
		);
		assert.throws(() =>
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, version: "v1.5" }),
		);
		assert.throws(() =>
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, version: "v1.5.0-rc1" }),
		);
	});

	it("rejects a publishedAt that is not ISO 8601", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({
				...GOOD_MANIFEST,
				publishedAt: "18 July 2026",
			}),
		);
	});

	it("rejects an empty summary", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, summary: "" }),
		);
	});

	it("rejects a summary over 140 characters", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({
				...GOOD_MANIFEST,
				summary: "x".repeat(141),
			}),
		);
	});

	it("accepts a summary at exactly 140 characters", () => {
		const summary = "x".repeat(140);
		assert.equal(
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, summary }).summary,
			summary,
		);
	});

	it("rejects a releaseNotesUrl that is not a URL", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({
				...GOOD_MANIFEST,
				releaseNotesUrl: "not-a-url",
			}),
		);
	});

	it("rejects an empty registry", () => {
		assert.throws(() =>
			UpdateManifestSchema.parse({ ...GOOD_MANIFEST, registry: "" }),
		);
	});

	it("rejects a manifest missing a required field", () => {
		const { summary, ...rest } = GOOD_MANIFEST;
		assert.throws(() => UpdateManifestSchema.parse(rest));
	});
});
