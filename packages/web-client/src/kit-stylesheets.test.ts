import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AUTH_COMPOSITIONS,
	bundleAppGraph,
	graphPath,
} from "@/test-support/bundle-app";

/**
 * A stylesheet the kit ships beside a component has to reach the app on its
 * own. #1062: `CalendarGrid`'s structural sheet was a subpath every consuming
 * app had to `@import` by hand, this one never did, and three releases drew the
 * week and day views as an unstyled stack with no events in them — while
 * Storybook, the render tests and the server render all read correctly, because
 * each of those pulled the sheet in itself.
 *
 * The kit's token sheet is the exception the app asks for by name: one theme,
 * loaded whether or not anything renders. Every other sheet is structural,
 * belongs to the component that cannot draw without it, and is checked here
 * against the bundler's own module graph walked from the app entry — so a sheet
 * no component imports fails the build instead of a deployment.
 */

const here = dirname(fileURLToPath(import.meta.url));
const kitSrc = resolve(here, "../../ui/src");

/** The kit's theme sheet, which `src/index.css` imports directly. */
const THEME_SHEET = join(kitSrc, "tokens.css");

const structuralSheets = (dir: string): string[] => {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") found.push(...structuralSheets(path));
			continue;
		}
		if (entry.name.endsWith(".css") && path !== THEME_SHEET) found.push(path);
	}
	return found.sort();
};

describe("kit stylesheets (#1062)", () => {
	it("walks every structural sheet @remit/ui ships from the app entry", async () => {
		const sheets = structuralSheets(kitSrc);
		assert.ok(
			sheets.length > 0,
			"the kit ships no structural sheet, so this asserts nothing — name the sheet it should follow, or drop it",
		);

		const { inputs } = await bundleAppGraph(AUTH_COMPOSITIONS.betterAuth);
		const reached = new Set(inputs.map(graphPath));
		const orphaned = sheets.filter((sheet) => !reached.has(sheet));

		assert.deepEqual(
			orphaned.map((sheet) => relative(kitSrc, sheet)),
			[],
			"a structural sheet no component imports never reaches the deployed app",
		);
	});
});
