// Exercises publish/remove against a real local git remote (a bare repo on
// disk) instead of mocking git -- the thing worth proving is that the orphan
// commit this writes actually preserves siblings and never grows past one
// commit, and that is only true if real git agrees.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { isLeaseRejection, publish, remove } from "./gh-pages-publish.mjs";

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

// Excludes .nojekyll: it is written on every operation regardless of --dest,
// so asserting it in every test below would just be noise. Its presence has
// its own dedicated tests instead.
function treePaths(remoteDir, branch) {
	if (!branchExists(remoteDir, branch)) return [];
	return git(remoteDir, ["ls-tree", "-r", "--name-only", branch])
		.split("\n")
		.filter((path) => path && path !== ".nojekyll")
		.sort();
}

function allTreePaths(remoteDir, branch) {
	if (!branchExists(remoteDir, branch)) return [];
	return git(remoteDir, ["ls-tree", "-r", "--name-only", branch])
		.split("\n")
		.filter(Boolean)
		.sort();
}

function commitCount(remoteDir, branch) {
	return Number(git(remoteDir, ["rev-list", "--count", branch]));
}

function readdirSyncSorted(dir) {
	return readdirSync(dir)
		.filter((entry) => entry !== ".git")
		.sort();
}

function worktreeDirFor(root) {
	const dir = join(root, `wt-${Math.random().toString(36).slice(2)}`);
	roots.push(dir);
	return dir;
}

// A second, independent clone pointed at the same remote -- standing in for
// a second workflow run publishing to the same branch. `race()` lands one
// more commit on `remoteDir` every time it is called, each one on top of
// whatever is there, so it can simulate a racer that keeps winning.
function racer(root, remoteDir) {
	const dir = join(root, `racer-${Math.random().toString(36).slice(2)}`);
	roots.push(dir);
	mkdirSync(dir, { recursive: true });
	git(dir, ["init", "--quiet"]);
	git(dir, ["config", "user.email", "racer@example.com"]);
	git(dir, ["config", "user.name", "racer"]);
	git(dir, ["remote", "add", "origin", remoteDir]);
	let count = 0;
	return function race() {
		count += 1;
		publish({
			repoRoot: dir,
			dest: `pr/racer-${count}/sha${count}`,
			sourceDir: sourceDir(root, `racer-payload-${count}`, {
				"index.html": `racer publish ${count}`,
			}),
			message: `racer publish ${count}`,
			worktreeDir: join(dir, `.race-worktree-${count}`),
		});
	};
}

// Every workflow that calls this script checks out the repo it runs from with
// a sparse-checkout limited to npm-scripts/ -- only the guard scripts, never
// the branch under preview. `core.sparseCheckout` lives in the repo's shared
// config, not per-worktree, so every worktree opened off that repo inherits
// the same restriction unless it is explicitly lifted.
function withSparseCheckout(repoRoot) {
	mkdirSync(join(repoRoot, "npm-scripts"), { recursive: true });
	writeFileSync(join(repoRoot, "npm-scripts", "placeholder.mjs"), "");
	git(repoRoot, ["add", "-A"]);
	git(repoRoot, ["commit", "--quiet", "-m", "seed npm-scripts"]);
	git(repoRoot, ["sparse-checkout", "set", "npm-scripts"]);
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

describe("a repoRoot checked out sparse", () => {
	it("still publishes a nested path when the branch does not exist yet", () => {
		const { root, remoteDir, repoRoot } = fixture();
		withSparseCheckout(repoRoot);

		const result = publish({
			repoRoot,
			dest: "pr/5/abc1234",
			sourceDir: sourceDir(root, "preview", { "index.html": "preview" }),
			message: "preview for pr 5",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"pr/5/abc1234/index.html",
		]);
	});

	it("still publishes a nested path alongside an existing gh-pages tree", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", { "index.html": "site" }),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});

		withSparseCheckout(repoRoot);
		const result = publish({
			repoRoot,
			dest: "pr/7/def0000",
			sourceDir: sourceDir(root, "pr7", { "index.html": "pr 7" }),
			message: "preview for pr 7",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"index.html",
			"pr/7/def0000/index.html",
		]);
	});

	it("still removes a nested path from an existing gh-pages tree", () => {
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

		withSparseCheckout(repoRoot);
		const result = remove({
			repoRoot,
			dest: "pr/7",
			message: "remove pr 7",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), ["index.html"]);
	});

	it("leaves the repoRoot's own sparse-checkout restriction in place", () => {
		const { root, repoRoot } = fixture();
		withSparseCheckout(repoRoot);

		publish({
			repoRoot,
			dest: "pr/5/abc1234",
			sourceDir: sourceDir(root, "preview", { "index.html": "preview" }),
			message: "preview for pr 5",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(git(repoRoot, ["config", "core.sparseCheckout"]), "true");
		assert.deepEqual(readdirSyncSorted(repoRoot), ["npm-scripts"]);
	});
});

describe(".nojekyll", () => {
	it("is written at the branch root on the first publish", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", { "index.html": "site" }),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});

		assert.ok(allTreePaths(remoteDir, "gh-pages").includes(".nojekyll"));
	});

	it("survives a root publish even though nothing preserves it explicitly", () => {
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
			dest: ".",
			sourceDir: sourceDir(root, "site-v2", { "index.html": "site v2" }),
			message: "publish main again",
			worktreeDir: worktreeDirFor(root),
		});

		assert.ok(allTreePaths(remoteDir, "gh-pages").includes(".nojekyll"));
	});

	it("is written by a preview publish and by a removal too", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: "pr/5/abc1234",
			sourceDir: sourceDir(root, "preview", { "index.html": "preview" }),
			message: "preview for pr 5",
			worktreeDir: worktreeDirFor(root),
		});
		assert.ok(allTreePaths(remoteDir, "gh-pages").includes(".nojekyll"));

		remove({
			repoRoot,
			dest: "pr/5",
			message: "remove pr 5",
			worktreeDir: worktreeDirFor(root),
		});
		assert.ok(allTreePaths(remoteDir, "gh-pages").includes(".nojekyll"));
	});
});

describe("CNAME", () => {
	it("survives a root publish that does not name it in --preserve", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site", {
				"index.html": "site",
				CNAME: "storybook.example.com",
			}),
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});

		publish({
			repoRoot,
			dest: ".",
			sourceDir: sourceDir(root, "site-v2", { "index.html": "site v2" }),
			message: "publish main again",
			worktreeDir: worktreeDirFor(root),
		});

		assert.ok(allTreePaths(remoteDir, "gh-pages").includes("CNAME"));
	});
});

describe("--nest", () => {
	it("replaces every other sha under the same PR, leaving other PRs alone", () => {
		const { root, remoteDir, repoRoot } = fixture();
		publish({
			repoRoot,
			dest: "pr/7",
			nest: "aaa0000",
			sourceDir: sourceDir(root, "pr7-first", { "index.html": "first build" }),
			message: "preview for pr 7 @ aaa0000",
			worktreeDir: worktreeDirFor(root),
		});
		publish({
			repoRoot,
			dest: "pr/9",
			nest: "zzz9999",
			sourceDir: sourceDir(root, "pr9", { "index.html": "pr 9 build" }),
			message: "preview for pr 9",
			worktreeDir: worktreeDirFor(root),
		});

		const result = publish({
			repoRoot,
			dest: "pr/7",
			nest: "bbb1111",
			sourceDir: sourceDir(root, "pr7-second", {
				"index.html": "second build",
			}),
			message: "preview for pr 7 @ bbb1111",
			worktreeDir: worktreeDirFor(root),
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"pr/7/bbb1111/index.html",
			"pr/9/zzz9999/index.html",
		]);
	});
});

describe("git add --force", () => {
	it("commits a file the published payload's own .gitignore would exclude", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const source = sourceDir(root, "site", {
			".gitignore": "assets/\n",
			"index.html": "site",
			"assets/app.js": "console.log(1)",
		});

		publish({
			repoRoot,
			dest: ".",
			sourceDir: source,
			message: "publish main",
			worktreeDir: worktreeDirFor(root),
		});

		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			".gitignore",
			"assets/app.js",
			"index.html",
		]);
	});
});

describe("isLeaseRejection", () => {
	it("recognizes a stale lease", () => {
		assert.equal(
			isLeaseRejection(" ! [rejected]        HEAD -> gh-pages (stale info)\n"),
			true,
		);
	});

	it("recognizes a lease staked on a ref that was expected not to exist yet", () => {
		assert.equal(
			isLeaseRejection(" ! [rejected]        HEAD -> gh-pages (fetch first)\n"),
			true,
		);
		assert.equal(
			isLeaseRejection(
				" ! [rejected]        HEAD -> gh-pages (already exists)\n",
			),
			true,
		);
	});

	it("ignores a rejection for an unrelated reason", () => {
		assert.equal(
			isLeaseRejection("remote: Permission to remit-mail/reader.git denied\n"),
			false,
		);
	});
});

describe("racing another publisher", () => {
	it("retries and incorporates a competing publish that lands mid-cycle", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const race = racer(root, remoteDir);
		let racerRan = false;

		// Only the first attempt races: a second publisher's push lands in the
		// window between this process's fetch and its own push, simulating
		// exactly what a shared concurrency group cannot rule out on its own --
		// a third arrival bumping a queued job does not stop that job's
		// already-running in-flight push.
		const result = publish({
			repoRoot,
			dest: "pr/7/aaa",
			sourceDir: sourceDir(root, "pr7", { "index.html": "pr 7 build" }),
			message: "preview for pr 7",
			worktreeDir: worktreeDirFor(root),
			_racer: () => {
				if (racerRan) return;
				racerRan = true;
				race();
			},
		});

		assert.equal(result.pushed, true);
		assert.deepEqual(treePaths(remoteDir, "gh-pages"), [
			"pr/7/aaa/index.html",
			"pr/racer-1/sha1/index.html",
		]);
		assert.equal(commitCount(remoteDir, "gh-pages"), 1);
	});

	it("gives up loudly once retries are exhausted against a permanent racer", () => {
		const { root, remoteDir, repoRoot } = fixture();
		const race = racer(root, remoteDir);

		assert.throws(
			() =>
				publish({
					repoRoot,
					dest: "pr/7/aaa",
					sourceDir: sourceDir(root, "pr7", { "index.html": "pr 7 build" }),
					message: "preview for pr 7",
					worktreeDir: worktreeDirFor(root),
					maxAttempts: 3,
					// Wins the race on every single attempt, so the retry can never
					// catch up -- proves this fails loudly instead of looping
					// forever or silently giving up.
					_racer: race,
				}),
			/gave up after 3 attempts/,
		);
	});
});
