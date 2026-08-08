// Exercises publish/remove against a real local git remote (a bare repo on
// disk) instead of mocking git -- the thing worth proving is that the orphan
// commit this writes actually preserves siblings and never grows past one
// commit, and that is only true if real git agrees.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { publish, remove } from "./gh-pages-publish.mjs";

const roots = [];

afterEach(() => {
	while (roots.length > 0) {
		rmSync(roots.pop(), { recursive: true, force: true });
	}
});

function git(cwd, args) {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "gh-pages-publish-fixture-"));
	roots.push(root);
	const remoteDir = join(root, "origin.git");
	const repoRoot = join(root, "repo");
	mkdirSync(remoteDir);
	git(remoteDir, ["init", "--quiet", "--bare"]);
	mkdirSync(repoRoot);
	git(repoRoot, ["init", "--quiet"]);
	git(repoRoot, ["config", "user.email", "test@example.com"]);
	git(repoRoot, ["config", "user.name", "test"]);
	git(repoRoot, ["remote", "add", "origin", remoteDir]);
	return { root, remoteDir, repoRoot };
}

function sourceDir(root, name, files) {
	const dir = join(root, name);
	for (const [path, contents] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, contents);
	}
	return dir;
}

function branchExists(remoteDir, branch) {
	return git(remoteDir, ["branch", "--list", branch]).length > 0;
}

function treePaths(remoteDir, branch) {
	if (!branchExists(remoteDir, branch)) return [];
	return git(remoteDir, ["ls-tree", "-r", "--name-only", branch])
		.split("\n")
		.filter(Boolean)
		.sort();
}

function commitCount(remoteDir, branch) {
	return Number(git(remoteDir, ["rev-list", "--count", branch]));
}

function worktreeDirFor(root) {
	const dir = join(root, `wt-${Math.random().toString(36).slice(2)}`);
	roots.push(dir);
	return dir;
}

describe("publish", () => {
	it("creates the branch when it does not exist yet", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const source = sourceDir(root, "site", { "index.html": "hello" });

		const result = publish({
			repoRoot,
			dest: ".",
			sourceDir: source,
			message: "first publish",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), ["index.html"]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});

	it("a root publish preserves an existing pr/ directory", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const preview = sourceDir(root, "preview", {
			"index.html": "preview build",
		});
		publish({
			repoRoot,
			dest: "pr/5/abc1234",
			sourceDir: preview,
			message: "preview for pr 5",
			worktreeDir: worktreeDirFor(root),
		});

		const site = sourceDir(root, "site-v2", {
			"index.html": "site build",
			"assets/app.js": "console.log(1)",
		});
		const result = publish({
			repoRoot,
			dest: ".",
			sourceDir: site,
			preserve: ["pr"],
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"assets/app.js",
			"index.html",
			"pr/5/abc1234/index.html",
		]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});

	it("a preview publish preserves the root and every other PR", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", { "index.html": "site" }),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});
		publish({
			repoRoot,
			dest: "pr/7/def0000",
			sourceDir: sourceDir(root, "pr7", { "index.html": "pr 7 build" }),
			message: "preview for pr 7",
			worktreeDir: worktreeDirFor(root),
		});

		const result = publish({
			repoRoot,
			dest: "pr/9/xyz9999",
			sourceDir: sourceDir(root, "pr9", { "index.html": "pr 9 build" }),
			message: "preview for pr 9",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"index.html",
			"pr/7/def0000/index.html",
			"pr/9/xyz9999/index.html",
		]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});

	it("republishing identical content pushes nothing", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const source = sourceDir(root, "site", { "index.html": "hello" });
		publish({
			repoRoot,
			dest: ".",
			sourceDir: source,
			message: "first",
			worktreeDir: worktreeDirFor(root),
		});
		const shaAfterFirst = git(remoteDir, ["rev-parse", "gh-pages"]);

		const result = publish({
			repoRoot,
			dest: ".",
			sourceDir: source,
			message: "second, unchanged",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, false);
		assert.equal(result.sha, null);
		assert.equal(git(remoteDir, ["rev-parse", "gh-pages"]), shaAfterFirst);
	});
});

describe("remove", () => {
	it("deletes only its own PR, leaving the root and other PRs", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", { "index.html": "site" }),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});
		publish({
			repoRoot,
			dest: "pr/7/def0000",
			sourceDir: sourceDir(root, "pr7", { "index.html": "pr 7" }),
			message: "preview for pr 7",
			worktreeDir: worktreeDirFor(root),
		});
		publish({
			repoRoot,
			dest: "pr/9/xyz9999",
			sourceDir: sourceDir(root, "pr9", { "index.html": "pr 9" }),
			message: "preview for pr 9",
			worktreeDir: worktreeDirFor(root),
		});

		const result = remove({
			repoRoot,
			dest: "pr/7",
			message: "remove pr 7",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"index.html",
			"pr/9/xyz9999/index.html",
		]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});

	it("removing a PR that was never published is a no-op", () => {
		const { root, remoteDir, repoRoot } = fixture();

		const result = remove({
			repoRoot,
			dest: "pr/1",
			message: "remove pr 1",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, false);
		assert.equal(result.sha, null);
		assert.equal(branchExists(remoteDir, "gh-pages"), false);
	});

	it("removing one PR after another leaves the branch history at one commit", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", { "index.html": "site" }),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});
		publish({
			repoRoot,
			dest: "pr/3/aaa",
			sourceDir: sourceDir(root, "pr3", { "index.html": "pr 3" }),
			message: "preview for pr 3",
			worktreeDir: worktreeDirFor(root),
		});

		remove({
			repoRoot,
			dest: "pr/3",
			message: "remove pr 3",
			worktreeDir: worktreeDirFor(root),
		});

		assert.deepEqual(treePaths(remoteDir, "gh-pages"), ["index.html"]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});
});
