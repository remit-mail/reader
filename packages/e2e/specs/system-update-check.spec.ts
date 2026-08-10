/**
 * The update panel's check control drives a real check (issue #599). Before
 * this, pressing it only re-read whatever the updater's own cadence had
 * already written — a real press never reached the updater at all.
 *
 * Proven end to end against the real control seam: the stack's manifest
 * fetch 404s from container boot (deploy/vps/e2e-manifest/data is empty), so
 * the panel starts in a known, stable "could not reach the update source"
 * state. This spec writes a real manifest file — content that cannot exist
 * before the test runs — presses the check button, and asserts the panel
 * renders exactly that content. The only way that content reaches the page
 * is a live round trip: POST /system/update/check writes the request,
 * `deploy/vps/remit`'s watch loop (docker/runtime/updater/entrypoint.sh)
 * picks it up, fetches the manifest, and writes state.json back.
 *
 * Image stack only (packages/e2e/src/stack.ts): the updater and the manifest
 * server are containers in docker-compose.sqlite.yml/.e2e.yml, absent from
 * the source-built dev lane the way Caddy and APISIX already are.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../src/fixtures.js";
import { imageStackOnly } from "../src/stack.js";

const REPO_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const MANIFEST_PATH = join(
	REPO_ROOT,
	"deploy",
	"vps",
	"e2e-manifest",
	"data",
	"manifest.json",
);

const FIXTURE_VERSION = "v0.99.5";
const FIXTURE_SUMMARY = `e2e check-request fixture, written at ${Date.now()}`;

function writeManifest(): void {
	mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
	writeFileSync(
		MANIFEST_PATH,
		JSON.stringify({
			version: FIXTURE_VERSION,
			registry: "ghcr.io/remit-mail/reader",
			publishedAt: "2026-01-01T00:00:00Z",
			summary: FIXTURE_SUMMARY,
			releaseNotesUrl: "https://example.test/notes",
		}),
	);
}

test.describe("The update panel's check control (issue #599)", () => {
	imageStackOnly(
		"the updater container and the manifest server only exist in the packaged stack",
	);

	test.afterEach(() => {
		rmSync(MANIFEST_PATH, { force: true });
	});

	test("pressing check reaches the updater, and the panel renders its answer", async ({
		page,
	}) => {
		await page.goto("/settings/advanced");

		// The stack's manifest fetch has 404'd since the updater's boot check —
		// no manifest.json is committed — so this is the known starting state,
		// not a race with the container's own startup.
		await expect(
			page.getByText("Could not reach the update source."),
		).toBeVisible({ timeout: 30_000 });

		// Content that cannot have reached the page any other way: it does not
		// exist on disk until this line runs.
		writeManifest();

		await page.getByRole("button", { name: "Try again" }).click();

		await expect(page.getByText(FIXTURE_SUMMARY)).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText(`Remit ${FIXTURE_VERSION}`)).toBeVisible();
	});
});
