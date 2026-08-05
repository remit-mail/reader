import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DESKTOP_MEDIA_QUERY } from "@remit/ui";
import { compile } from "tailwindcss";

const here = dirname(fileURLToPath(import.meta.url));

const entryStylesheets = {
	app: resolve(here, "../index.css"),
	workbench: resolve(here, "../../../workbench/.storybook/tailwind.css"),
};

const loadStylesheet = async (id: string, base: string) => {
	const require = createRequire(resolve(base, "resolve-from-here.js"));
	const path =
		id.startsWith(".") || id.startsWith("/")
			? resolve(base, id)
			: resolveCssExport(require, id);
	return { path, base: dirname(path), content: await readFile(path, "utf8") };
};

const resolveCssExport = (require: NodeRequire, id: string): string => {
	const direct = tryResolve(require, id);
	if (direct?.endsWith(".css")) return direct;
	return require.resolve(`${id}/index.css`);
};

const tryResolve = (require: NodeRequire, id: string): string | undefined => {
	try {
		return require.resolve(id);
	} catch {
		return undefined;
	}
};

/**
 * The media condition Tailwind wraps a utility in, read back off the compiled
 * stylesheet. Building one candidate at a time keeps a single rule inside the
 * block, so the prelude immediately precedes it.
 */
const compiledMediaConditionFor = async (
	stylesheet: string,
	utility: string,
): Promise<string> => {
	const compiler = await compile(await readFile(stylesheet, "utf8"), {
		base: dirname(stylesheet),
		loadStylesheet,
	});
	const css = compiler.build([utility]);
	const escaped = utility.replace(/:/g, "\\\\:");
	const match = css.match(
		new RegExp(`@media ([^\\n{]+?)\\s*\\{\\s*\\.${escaped}\\s*\\{`),
	);
	assert.ok(match, `${utility} emitted no media-wrapped rule in ${stylesheet}`);
	return match[1];
};

describe("the lg variant and the desktop hooks gate on the same condition", () => {
	// Regression: the desktop gate used to be a bare 1024px width, so a large
	// tablet in portrait — exactly 1024px wide — got the four-pane desktop
	// shell. Two systems encode the gate: DESKTOP_MEDIA_QUERY drives the JS
	// hooks, and Tailwind's `lg` variant (redefined in @remit/ui's token sheet)
	// drives the CSS chrome. If either moves alone the app splits in half.
	for (const [name, stylesheet] of Object.entries(entryStylesheets)) {
		it(`compiles lg:hidden in the ${name} stylesheet to DESKTOP_MEDIA_QUERY`, async () => {
			assert.equal(
				await compiledMediaConditionFor(stylesheet, "lg:hidden"),
				DESKTOP_MEDIA_QUERY,
			);
		});
	}

	it("excludes a coarse pointer held upright", () => {
		assert.match(DESKTOP_MEDIA_QUERY, /min-width: 1024px/);
		assert.match(
			DESKTOP_MEDIA_QUERY,
			/not \(\(orientation: portrait\) and \(pointer: coarse\)\)/,
		);
	});
});
