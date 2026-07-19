import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Tailwind v4 roots automatic source detection at the bundler's root. The
 * distributor harness builds from a throwaway root holding only the entry, so
 * nothing this app renders is discovered automatically: every directory whose
 * components carry utility classes has to be named by an `@source` rule. When
 * one is missing the build still succeeds — it just ships a stylesheet with
 * those utilities absent, and the screens using them lay out as unstyled boxes
 * (#57: the settings slide-over covered the whole viewport).
 */

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, "index.css");
const css = readFileSync(cssPath, "utf8");

/** Globs Tailwind scans, and globs it is told to skip. */
const globs = (kind: "include" | "exclude"): string[] =>
	[...css.matchAll(/@source\s+(not\s+)?"([^"]+)"/g)]
		.filter(([, negated]) => (kind === "exclude") === Boolean(negated))
		.map(([, , glob]) => glob);

/** The directory an `@source` glob starts scanning from. */
const sourceRoots = (): string[] =>
	globs("include").map((glob) => {
		const literal = glob.split("*")[0] ?? glob;
		return resolve(dirname(cssPath), literal);
	});

/** Every directory below `root` that holds a component file. */
const componentDirs = (root: string): string[] => {
	const found: string[] = [];
	const walk = (dir: string): void => {
		const entries = readdirSync(dir, { withFileTypes: true });
		if (entries.some((e) => e.isFile() && e.name.endsWith(".tsx"))) {
			found.push(dir);
		}
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name !== "node_modules") {
				walk(resolve(dir, entry.name));
			}
		}
	};
	walk(root);
	return found;
};

const isCovered = (dir: string, roots: string[]): boolean =>
	roots.some((root) => {
		const rel = relative(root, dir);
		return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
	});

describe("tailwind source coverage (#57)", () => {
	const roots = sourceRoots();

	it("declares at least one source", () => {
		assert.ok(roots.length > 0);
	});

	it("covers every directory in this package that renders components", () => {
		const uncovered = componentDirs(here).filter((d) => !isCovered(d, roots));
		assert.deepEqual(
			uncovered.map((d) => relative(here, d)),
			[],
		);
	});

	it("covers the linked design system package", () => {
		const ui = resolve(here, "../../ui/src");
		const uncovered = componentDirs(ui).filter((d) => !isCovered(d, roots));
		assert.deepEqual(
			uncovered.map((d) => relative(ui, d)),
			[],
		);
	});

	/**
	 * A test asserting on a class string is a class string in a scanned file, so
	 * without this every utility a test names is emitted into the shipped CSS.
	 */
	it("excludes test files from every source it scans", () => {
		const uncovered = globs("include").filter(
			(glob) =>
				!globs("exclude").some(
					(excluded) =>
						excluded ===
						glob.replace(/\/\*\*\/\*\.\{ts,tsx\}$/, "/**/*.test.{ts,tsx}"),
				),
		);
		assert.deepEqual(uncovered, []);
	});
});
