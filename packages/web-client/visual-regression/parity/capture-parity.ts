/**
 * Parity capture script.
 *
 * For each row in the manifest × viewport × theme (light | dark):
 *   - Live side: navigates the real app (reuses the visual webServer seed),
 *     runs any steps to reach the sub-state, forces theme via
 *     localStorage["remit.theme"] + Playwright colorScheme, waits for settle,
 *     then screenshots to tmp/parity/<surface>/<state>__<viewport>__<theme>.live.png.
 *   - Story side: navigates Storybook's iframe (/iframe.html?id=<id>&globals=theme:<theme>),
 *     waits for .sb-show-main, then screenshots to the same path but with .story.png.
 *     Rows with story: null are skipped on the story side.
 *
 * Prerequisites:
 *   - The visual harness's web-server + seed must be running (i.e. run via
 *     the `parity:capture` npm script which invokes playwright directly, or
 *     ensure the backend + Vite are already up on their respective ports).
 *   - Storybook must be running on :6007 for story captures.
 *     Start it with: npm run storybook -w packages/remit-ui
 *     (or whichever script launches Storybook in this repo).
 *
 * Output: tmp/parity/<surface>/<state>__<viewport>__<theme>.<live|story>.png
 *
 * Run via:
 *   npm run parity:capture -w packages/remit-web-client
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { manifest, type ParityRow, type Viewport } from "./parity.manifest.ts";

const __filename = fileURLToPath(import.meta.url);
// Resolve from packages/remit-web-client (four levels up from this file:
// parity/ → visual-regression/ → remit-web-client/)
const PKG_ROOT = resolve(dirname(__filename), "../..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");

const VITE_PORT = Number.parseInt(process.env.VISUAL_VITE_PORT ?? "5173", 10);
const STORYBOOK_PORT = Number.parseInt(
	process.env.STORYBOOK_PORT ?? "6007",
	10,
);

const LIVE_BASE = `http://localhost:${VITE_PORT}`;
const STORY_BASE = `http://localhost:${STORYBOOK_PORT}`;

// Output root — relative to repo root so `tmp/` is at the workspace root.
const OUT_ROOT = resolve(REPO_ROOT, "tmp", "parity");

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

/** Playwright viewport dimensions keyed by the manifest's Viewport label. */
const VIEWPORT_SIZES: Record<Viewport, { width: number; height: number }> = {
	phone: { width: 390, height: 844 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1440, height: 900 },
};

const ensureDir = async (dir: string): Promise<void> => {
	await mkdir(dir, { recursive: true });
};

const outPath = (
	surface: string,
	state: string,
	viewport: Viewport,
	theme: Theme,
	side: "live" | "story",
): string =>
	resolve(OUT_ROOT, surface, `${state}__${viewport}__${theme}.${side}.png`);

/** Run a manifest step against the live page. */
const runStep = async (
	page: import("@playwright/test").Page,
	step: NonNullable<ParityRow["live"]["steps"]>[number],
): Promise<void> => {
	if (step.action === "click") {
		await page.locator(step.selector).click();
	} else if (step.action === "fill") {
		await page.locator(step.selector).fill(step.value);
	} else if (step.action === "wait") {
		await page.locator(step.selector).waitFor({ state: "visible" });
	}
};

/** Capture the live side for one row × viewport × theme. */
const captureLive = async (
	row: ParityRow,
	viewport: Viewport,
	theme: Theme,
): Promise<void> => {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: VIEWPORT_SIZES[viewport],
			colorScheme: theme === "dark" ? "dark" : "light",
		});
		const page = await context.newPage();

		// Force theme via localStorage init script (runs before page scripts).
		await page.addInitScript((t) => {
			localStorage.setItem("remit.theme", t);
		}, theme);

		await page.goto(`${LIVE_BASE}${row.live.route}`);
		await page.waitForLoadState("networkidle");

		// Run interaction steps to reach the sub-state.
		for (const step of row.live.steps ?? []) {
			await runStep(page, step);
		}

		// Give animations / transitions a moment to settle.
		await page.waitForTimeout(300);

		const dest = outPath(row.surface, row.state, viewport, theme, "live");
		await ensureDir(dirname(dest));
		const shot = await page.screenshot({ fullPage: false });
		await writeFile(dest, shot);
		console.log(`  captured live → ${dest.replace(REPO_ROOT + "/", "")}`);

		await context.close();
	} finally {
		await browser.close();
	}
};

/** Capture the story side for one row × viewport × theme. */
const captureStory = async (
	row: ParityRow & { story: NonNullable<ParityRow["story"]> },
	viewport: Viewport,
	theme: Theme,
): Promise<void> => {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: VIEWPORT_SIZES[viewport],
			colorScheme: theme === "dark" ? "dark" : "light",
		});
		const page = await context.newPage();

		const storyUrl = `${STORY_BASE}/iframe.html?id=${encodeURIComponent(row.story.id)}&globals=theme:${theme}`;
		await page.goto(storyUrl);
		// Wait for the Storybook story to mount.
		await page.locator(".sb-show-main").waitFor({ state: "visible" });
		// Give the story a moment to finish any internal animations.
		await page.waitForTimeout(300);

		const dest = outPath(row.surface, row.state, viewport, theme, "story");
		await ensureDir(dirname(dest));
		const shot = await page.screenshot({ fullPage: false });
		await writeFile(dest, shot);
		console.log(`  captured story → ${dest.replace(REPO_ROOT + "/", "")}`);

		await context.close();
	} finally {
		await browser.close();
	}
};

const run = async (): Promise<void> => {
	console.log(
		`Parity capture — ${manifest.length} rows × ${THEMES.length} themes`,
	);
	console.log(`Live base: ${LIVE_BASE}`);
	console.log(`Story base: ${STORY_BASE} (must be running for story rows)`);
	console.log(`Output root: ${OUT_ROOT}`);
	console.log();

	let totalCaptures = 0;
	let skipped = 0;

	for (const row of manifest) {
		console.log(`[${row.surface}/${row.state}]`);

		for (const viewport of row.viewports) {
			for (const theme of THEMES) {
				// Live capture.
				await captureLive(row, viewport, theme);
				totalCaptures++;

				// Story capture — skip when story is null.
				if (row.story !== null) {
					await captureStory(
						row as ParityRow & { story: NonNullable<ParityRow["story"]> },
						viewport,
						theme,
					);
					totalCaptures++;
				} else {
					skipped++;
				}
			}
		}
	}

	console.log();
	console.log(
		`Done. ${totalCaptures} screenshots captured, ${skipped} story sides skipped (no story).`,
	);
	console.log(`Output: ${OUT_ROOT}`);
};

run().catch((err) => {
	console.error("parity:capture failed:", err);
	process.exit(1);
});
