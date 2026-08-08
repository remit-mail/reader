import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CHECKED_LINE,
	decideEligibility,
	formatTimestamp,
	isTicked,
	MARKER,
	renderBody,
	UNCHECKED_LINE,
} from "./storybook-preview-comment.mjs";

function readWorkflow(name) {
	return readFileSync(
		fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)),
		"utf8",
	);
}

const pagesWorkflow = readWorkflow("storybook-pages.yml");
const previewWorkflow = readWorkflow("storybook-preview.yml");
const cleanupWorkflow = readWorkflow("storybook-preview-cleanup.yml");

function concurrencyGroups(text) {
	return [...text.matchAll(/^\s*group:\s*(.+)$/gm)].map((match) =>
		match[1].trim(),
	);
}

function view(state, overrides = {}) {
	return {
		state,
		sha: "0123456789abcdef",
		url: "https://remit-mail.github.io/reader/pr/42/0123456789abcdef/",
		runUrl: "https://github.com/remit-mail/reader/actions/runs/1",
		reason: "the build failed",
		at: "2026-08-03 12:00 UTC",
		...overrides,
	};
}

describe("renderBody", () => {
	it("marks every state with the sticky marker", () => {
		const states = [
			"idle",
			"building",
			"deployed",
			"failed",
			"refused",
			"removed",
		];
		for (const state of states) {
			assert.ok(renderBody(view(state)).startsWith(MARKER));
		}
	});

	it("leaves the box unticked in every state that can deploy", () => {
		const states = ["idle", "building", "deployed", "failed", "refused"];
		for (const state of states) {
			const body = renderBody(view(state));
			assert.ok(body.includes(UNCHECKED_LINE), state);
			assert.ok(!body.includes(CHECKED_LINE), state);
		}
	});

	it("drops the box once the pull request is closed", () => {
		const body = renderBody(view("removed"));
		assert.ok(!body.includes(UNCHECKED_LINE));
		assert.ok(body.includes("deleted"));
	});

	it("links the preview and names the commit when deployed", () => {
		const body = renderBody(view("deployed"));
		assert.ok(
			body.includes(
				"https://remit-mail.github.io/reader/pr/42/0123456789abcdef/",
			),
		);
		assert.ok(body.includes("`0123456`"));
		assert.ok(body.includes("2026-08-03 12:00 UTC"));
	});

	it("names the reason and links the run when a deploy fails", () => {
		const body = renderBody(view("failed", { reason: "npm ci exited 1" }));
		assert.ok(body.includes("npm ci exited 1"));
		assert.ok(
			body.includes("https://github.com/remit-mail/reader/actions/runs/1"),
		);
	});

	it("explains a refusal without linking a run", () => {
		const body = renderBody(
			view("refused", { reason: "the branch lives in a fork." }),
		);
		assert.ok(body.includes("the branch lives in a fork."));
		assert.ok(!body.includes("actions/runs"));
	});
});

describe("isTicked", () => {
	it("reads a ticked box", () => {
		assert.equal(isTicked(`${MARKER}\n\n${CHECKED_LINE}\n`), true);
	});

	it("ignores an unticked box", () => {
		assert.equal(isTicked(renderBody(view("idle"))), false);
	});

	it("ignores a ticked box in a comment that is not ours", () => {
		assert.equal(isTicked(`${CHECKED_LINE}\n`), false);
	});
});

describe("decideEligibility", () => {
	const base = {
		prState: "open",
		headRepo: "remit-mail/reader",
		baseRepo: "remit-mail/reader",
		permission: "write",
	};

	it("allows write, maintain and admin", () => {
		for (const permission of ["write", "maintain", "admin"]) {
			assert.equal(decideEligibility({ ...base, permission }).eligible, true);
		}
	});

	it("refuses read access and non-collaborators", () => {
		for (const permission of ["read", "none", ""]) {
			const decision = decideEligibility({ ...base, permission });
			assert.equal(decision.eligible, false);
			assert.match(decision.reason, /write access/);
		}
	});

	it("refuses a branch pushed to a fork", () => {
		const decision = decideEligibility({ ...base, headRepo: "someone/reader" });
		assert.equal(decision.eligible, false);
		assert.match(decision.reason, /fork/);
	});

	it("refuses a closed pull request", () => {
		const decision = decideEligibility({ ...base, prState: "closed" });
		assert.equal(decision.eligible, false);
		assert.match(decision.reason, /not open/);
	});

	it("checks the fork before the permission of the person ticking", () => {
		const decision = decideEligibility({
			...base,
			headRepo: "someone/reader",
			permission: "admin",
		});
		assert.equal(decision.eligible, false);
	});
});

describe("formatTimestamp", () => {
	it("prints minutes in UTC", () => {
		assert.equal(
			formatTimestamp(new Date("2026-08-03T12:34:56.789Z")),
			"2026-08-03 12:34 UTC",
		);
	});
});

describe("the deploy workflow trigger", () => {
	it("matches the exact lines this renderer writes", () => {
		assert.ok(previewWorkflow.includes(MARKER));
		assert.ok(previewWorkflow.includes(CHECKED_LINE));
	});

	it("detects the unchecked-to-checked edge, not just a checked box", () => {
		assert.match(
			previewWorkflow,
			/!contains\(github\.event\.changes\.body\.from, '- \[x\] Deploy Storybook preview'\)/,
		);
	});
});

describe("the per-PR build concurrency group", () => {
	it("is shared between the preview build and cleanup's guard, and cancels", () => {
		const buildGroups = concurrencyGroups(
			previewWorkflow.slice(0, previewWorkflow.indexOf("publish:")),
		);
		const cleanupGroups = concurrencyGroups(
			cleanupWorkflow.slice(0, cleanupWorkflow.indexOf("remove:")),
		);
		assert.equal(buildGroups.length, 1);
		assert.equal(cleanupGroups.length, 1);
		assert.equal(buildGroups[0], cleanupGroups[0]);
		assert.match(buildGroups[0], /^storybook-preview-/);
	});

	it("cancels whatever is already running in that group", () => {
		const buildJob = previewWorkflow.slice(
			0,
			previewWorkflow.indexOf("publish:"),
		);
		const guardJob = cleanupWorkflow.slice(
			0,
			cleanupWorkflow.indexOf("remove:"),
		);
		for (const text of [buildJob, guardJob]) {
			assert.match(text, /cancel-in-progress: true/);
		}
	});
});

describe("the gh-pages push concurrency group", () => {
	it("is the same literal group across all three workflows' push jobs", () => {
		const pagesGroups = concurrencyGroups(pagesWorkflow);
		const previewPublishGroups = concurrencyGroups(
			previewWorkflow.slice(previewWorkflow.indexOf("publish:")),
		);
		const cleanupRemoveGroups = concurrencyGroups(
			cleanupWorkflow.slice(cleanupWorkflow.indexOf("remove:")),
		);
		assert.equal(pagesGroups.length, 1);
		assert.equal(previewPublishGroups.length, 1);
		assert.equal(cleanupRemoveGroups.length, 1);
		assert.equal(pagesGroups[0], "gh-pages-branch-push");
		assert.equal(previewPublishGroups[0], "gh-pages-branch-push");
		assert.equal(cleanupRemoveGroups[0], "gh-pages-branch-push");
	});

	it("never cancels an in-flight push, only queues behind it", () => {
		const pagesPush = pagesWorkflow.slice(pagesWorkflow.indexOf("publish:"));
		const previewPush = previewWorkflow.slice(
			previewWorkflow.indexOf("publish:"),
		);
		const cleanupPush = cleanupWorkflow.slice(
			cleanupWorkflow.indexOf("remove:"),
		);
		for (const text of [pagesPush, previewPush, cleanupPush]) {
			assert.match(text, /cancel-in-progress: false/);
		}
	});
});

describe("the preview publish job", () => {
	it("asks again whether the pull request is open before it publishes", () => {
		const publishJob = previewWorkflow.slice(
			previewWorkflow.indexOf("publish:"),
		);
		const recheck = publishJob.indexOf("storybook-preview-comment.mjs state");
		const publishStep = publishJob.indexOf("gh-pages-publish.mjs publish");
		assert.ok(recheck > 0);
		assert.ok(recheck < publishStep);
	});

	it("never gives the pull-request-branch build step a token with write scope", () => {
		const buildJob = previewWorkflow.slice(
			previewWorkflow.indexOf("build:"),
			previewWorkflow.indexOf("publish:"),
		);
		assert.match(buildJob, /contents: read/);
		assert.ok(!buildJob.includes("contents: write"));
	});
});
