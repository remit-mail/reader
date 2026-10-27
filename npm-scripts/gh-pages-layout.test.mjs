// The docs site is the one workflow that writes the `gh-pages` branch, and it
// owns all of it. Its destination and its queueing are pinned here rather than
// left to a reviewer to notice.
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

	it("queues behind another push instead of cancelling it", () => {
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
