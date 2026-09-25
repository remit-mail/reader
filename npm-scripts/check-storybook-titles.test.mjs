import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	checkRepo,
	checkStory,
	mountedUiModules,
	readMeta,
	storySubjects,
	uiEntryPoints,
} from "./check-storybook-titles.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function story(meta) {
	return [
		'import type { Meta } from "@storybook/react-vite";',
		'const args = { title: "Not the meta title" };',
		`const meta = {\n${meta}\n\tparameters: { title: "nested" },\n} satisfies Meta;`,
		"export default meta;",
	].join("\n");
}

const ui = "packages/ui/src/components/button.stories.tsx";
const webClient = "packages/web-client/src/components/mail/list.stories.tsx";
const workbench = "packages/workbench/src/flows/drafts.stories.tsx";

describe("readMeta", () => {
	it("reads the default-exported meta's own title and tags", () => {
		assert.deepEqual(
			readMeta(
				story('\ttitle: "Design System/Button",\n\ttags: ["proposed"],'),
			),
			{ title: "Design System/Button", tags: ["proposed"] },
		);
	});

	it("decodes an escaped single-quoted title", () => {
		assert.deepEqual(readMeta(story("\ttitle: 'Design System/It\\'s',")), {
			title: "Design System/It's",
			tags: [],
		});
	});

	it("reports a meta without a literal title, which Storybook would auto-title", () => {
		assert.ok("error" in readMeta(story("\tcomponent: Button,")));
	});
});

describe("checkStory", () => {
	it("accepts each package under its own root", () => {
		assert.deepEqual(
			checkStory({
				path: ui,
				source: story('\ttitle: "Design System/Button",'),
			}),
			[],
		);
		assert.deepEqual(
			checkStory({
				path: webClient,
				source: story('\ttitle: "Playground/Shipped/Mail/List",'),
			}),
			[],
		);
		assert.deepEqual(
			checkStory({
				path: workbench,
				source: story(
					'\ttitle: "Playground/Proposed/Drafts",\n\ttags: ["proposed"],',
				),
			}),
			[],
		);
	});

	it("fails a story outside the three roots", () => {
		const problems = checkStory({
			path: ui,
			source: story('\ttitle: "Screens/Kit/Button",'),
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /Screens\/Kit\/Button/);
	});

	it("fails a title that names only a root", () => {
		assert.equal(
			checkStory({ path: ui, source: story('\ttitle: "Design System/",') })
				.length,
			1,
		);
	});

	it("fails a package outside its own roots", () => {
		assert.equal(
			checkStory({
				path: webClient,
				source: story('\ttitle: "Design System/List",'),
			}).length,
			1,
		);
		assert.equal(
			checkStory({
				path: workbench,
				source: story(
					'\ttitle: "Playground/Shipped/Drafts",\n\ttags: ["proposed"],',
				),
			}).length,
			1,
		);
	});

	it("fails a workbench story missing the proposed tag", () => {
		const problems = checkStory({
			path: workbench,
			source: story(
				'\ttitle: "Playground/Proposed/Drafts",\n\ttags: ["autodocs"],',
			),
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /"proposed" tag/);
	});

	it("fails a story file outside the storybook packages", () => {
		assert.equal(
			checkStory({
				path: "packages/mailbox-service/src/x.stories.tsx",
				source: story('\ttitle: "Design System/X",'),
			}).length,
			1,
		);
	});
	it("fails a ui story tagged proposed whose component web-client mounts", () => {
		const problems = checkStory({
			path: ui,
			source: story('\ttitle: "Design System/Button",\n\ttags: ["proposed"],'),
			mounted: true,
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /cannot carry the "proposed" tag/);
	});

	it("fails an untagged ui story whose component web-client never mounts", () => {
		const problems = checkStory({
			path: ui,
			source: story('\ttitle: "Design System/Button",'),
			mounted: false,
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /needs the "proposed" tag/);
	});

	it("accepts a ui story whose tag matches its consumers", () => {
		assert.deepEqual(
			checkStory({
				path: ui,
				source: story('\ttitle: "Design System/Button",'),
				mounted: true,
			}),
			[],
		);
		assert.deepEqual(
			checkStory({
				path: ui,
				source: story(
					'\ttitle: "Design System/Button",\n\ttags: ["proposed"],',
				),
				mounted: false,
			}),
			[],
		);
	});
});

const kit = "packages/ui/src";
const app = "packages/web-client/src";
const entryPoints = uiEntryPoints({
	exports: {
		".": "./src/index.ts",
		"./rich-text": "./src/rich-text.ts",
		"./tokens.css": "./src/tokens.css",
	},
});

function sources(web) {
	return new Map([
		[
			`${kit}/index.ts`,
			[
				'export { mergeProps } from "react-aria";',
				'export { Button, type ButtonProps } from "./components/button.js";',
				'export { Card } from "./components/card.js";',
				'export * from "./components/row.js";',
			].join("\n"),
		],
		[`${kit}/rich-text.ts`, 'export { Editor } from "./components/editor.js";'],
		[
			`${kit}/components/button.tsx`,
			'import { Icon } from "./icon.js";\nexport function Button() {}',
		],
		[`${kit}/components/icon.tsx`, "export function Icon() {}"],
		[`${kit}/components/card.tsx`, "export const Card = () => null;"],
		[`${kit}/components/row.tsx`, "export function Row() {}"],
		[`${kit}/components/editor.tsx`, "export function Editor() {}"],
		...Object.entries(web).map(([path, source]) => [`${app}/${path}`, source]),
	]);
}

describe("mountedUiModules", () => {
	it("maps the ui package exports onto its source files", () => {
		assert.deepEqual(
			[...entryPoints],
			[
				["@remit/ui", `${kit}/index.ts`],
				["@remit/ui/rich-text", `${kit}/rich-text.ts`],
			],
		);
	});

	it("follows a named import through the barrel and the module's own imports", () => {
		const { mounted, problems } = mountedUiModules(
			sources({
				"shell.tsx": 'import { Button, mergeProps } from "@remit/ui";',
			}),
			entryPoints,
		);
		assert.deepEqual(problems, []);
		assert.deepEqual([...mounted].sort(), [
			`${kit}/components/button.tsx`,
			`${kit}/components/icon.tsx`,
		]);
	});

	it("resolves a name the barrel re-exports with export *", () => {
		const { mounted } = mountedUiModules(
			sources({ "list.tsx": 'import { Row } from "@remit/ui";' }),
			entryPoints,
		);
		assert.deepEqual([...mounted], [`${kit}/components/row.tsx`]);
	});

	it("counts a dynamic import of a subpath as the whole module", () => {
		const { mounted } = mountedUiModules(
			sources({
				"compose.tsx":
					'const Body = lazy(() => import("@remit/ui/rich-text"));',
			}),
			entryPoints,
		);
		assert.ok(mounted.has(`${kit}/components/editor.tsx`));
		assert.ok(!mounted.has(`${kit}/components/card.tsx`));
	});

	it("ignores comments, strings, type-only imports, stories and tests", () => {
		const { mounted } = mountedUiModules(
			sources({
				"mail.tsx": [
					'// import { Card } from "@remit/ui";',
					"/*",
					'import { Row } from "@remit/ui";',
					"*/",
					'import type { Card } from "@remit/ui";',
					'import { type ButtonProps } from "@remit/ui";',
					"const hint = 'import(\"@remit/ui/rich-text\")';",
				].join("\n"),
				"mail.stories.tsx": 'import { Card } from "@remit/ui";',
				"mail.test.ts": 'import { Row } from "@remit/ui";',
				"test-support/dom.ts": 'import { Row } from "@remit/ui";',
			}),
			entryPoints,
		);
		assert.deepEqual([...mounted], []);
	});

	it("reports a name it cannot trace to a ui module", () => {
		const { problems } = mountedUiModules(
			sources({ "shell.tsx": 'import { Missing } from "@remit/ui";' }),
			entryPoints,
		);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /Missing/);
	});
});

describe("storySubjects", () => {
	it("is the story's sibling module when it has one", () => {
		const files = sources({});
		files.set(
			`${kit}/components/button.stories.tsx`,
			'import { Card } from "./card.js";',
		);
		assert.deepEqual(
			storySubjects(files, `${kit}/components/button.stories.tsx`),
			[`${kit}/components/button.tsx`],
		);
	});

	it("is every ui module the story imports otherwise, less fixtures", () => {
		const files = sources({});
		files.set(`${kit}/components/overview-fixtures.ts`, "export const a = 1;");
		files.set(
			`${kit}/components/overview.stories.tsx`,
			[
				'import { Card } from "./card.js";',
				'import type { Row } from "./row.js";',
				'import { a } from "./overview-fixtures.js";',
			].join("\n"),
		);
		assert.deepEqual(
			storySubjects(files, `${kit}/components/overview.stories.tsx`),
			[`${kit}/components/card.tsx`],
		);
	});
});

describe("the repo's stories", () => {
	it("all sit under their package's roots", async () => {
		const { count, problems } = await checkRepo(repo);
		assert.deepEqual(problems, []);
		assert.ok(count > 0);
	});
});
