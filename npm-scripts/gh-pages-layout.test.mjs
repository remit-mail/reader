// Four workflows write to the one `gh-pages` branch, and each owns a different
// part of it: the docs site owns the root, the Storybook owns `storybook/`, and
// the previews own `pr/`. A root publish that forgets to preserve a subtree
// deletes a live site, and the loss only shows up the next time someone opens
// it -- so the destinations and the preserved entries are pinned here rather
// than left to a reviewer to notice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function readWorkflow(name) {
	return readFileSync(
		fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)),
		"utf8",
	);
}

const docsWorkflow = readWorkflow("docs-site.yml");
const pagesWorkflow = readWorkflow("storybook-pages.yml");
const previewWorkflow = readWorkflow("storybook-preview.yml");

function publishCommand(workflow) {
	const start = workflow.indexOf("gh-pages-publish.mjs publish");
	assert.ok(start > 0, "no gh-pages publish step");
	return workflow.slice(start).split(/\n\s*\n/)[0];
}

describe("the docs site publish", () => {
	const command = publishCommand(docsWorkflow);

	it("owns the branch root", () => {
		assert.match(command, /--dest\s+\.$/m);
	});

	it("preserves the Storybook and the pull request previews", () => {
		assert.match(command, /--preserve\s+storybook$/m);
		assert.match(command, /--preserve\s+pr$/m);
	});

	it("queues behind the other branch producers instead of cancelling one", () => {
		const publishJob = docsWorkflow.slice(docsWorkflow.indexOf("publish:"));
		assert.match(publishJob, /group: gh-pages-branch-push/);
		assert.match(publishJob, /cancel-in-progress: false/);
	});

	it("rebuilds when the site sources move under doc/remit.email", () => {
		const trigger = docsWorkflow.slice(0, docsWorkflow.indexOf("permissions:"));
		assert.match(trigger, /- "doc\/remit\.email\/\*\*"/);
		assert.match(trigger, /workflow_dispatch:/);
	});
});

describe("the Storybook publish", () => {
	it("writes a subtree, so the docs site at the root survives it", () => {
		const command = publishCommand(pagesWorkflow);
		assert.match(command, /--dest\s+storybook$/m);
		assert.ok(!/--dest\s+\.$/m.test(command));
	});
});

describe("a preview publish", () => {
	it("stays under the pr/ subtree the root publish preserves", () => {
		const command = publishCommand(previewWorkflow);
		assert.match(command, /--dest\s+"pr\/\$PR_NUMBER"/);
	});

	it("advertises a link under that same subtree", () => {
		assert.match(
			previewWorkflow,
			/PAGES_BASE_URL\/pr\/\$PR_NUMBER\/\$HEAD_SHA/,
		);
	});
});
