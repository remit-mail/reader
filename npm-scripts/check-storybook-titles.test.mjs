import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkRepo, checkStory, readMeta } from "./check-storybook-titles.mjs";

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
});

describe("the repo's stories", () => {
	it("all sit under their package's roots", async () => {
		const { count, problems } = await checkRepo(repo);
		assert.deepEqual(problems, []);
		assert.ok(count > 0);
	});
});
