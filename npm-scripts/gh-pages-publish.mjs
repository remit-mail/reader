#!/usr/bin/env node
// Publishes a built directory into a subtree of the `gh-pages` branch as a
// single orphan commit, force-pushed. Shared by every workflow that writes to
// that branch (the main-site publish, a per-PR preview publish, and preview
// cleanup) so the branch never grows without bound and a push either lands
// whole or not at all -- there is no partial state to observe mid-push.
//
// The branch is rebuilt from its own current tip each time (via a detached
// worktree), so nothing already on the branch is lost by starting fresh:
// `publish` overwrites only `--dest` and leaves the rest of the tree exactly
// as it was; `remove` deletes only `--dest`.
import { execFileSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL =
	"41898282+github-actions[bot]@users.noreply.github.com";

const USAGE = `usage: gh-pages-publish.mjs <command> [options]

Commands:
  publish  Replace --dest on the branch with the contents of --source.
  remove   Delete --dest from the branch.

Options:
  --dest <path>        Subtree to write or delete. "." means the branch root.
  --source <dir>        Directory to publish (publish only).
  --preserve <path>     Root entry to leave untouched (publish, --dest ".", repeatable).
  --message <text>      Commit message for the orphan commit.
  --branch <name>        Target branch (default gh-pages).
  --remote <name>        Git remote (default origin).
  --repo <path>          Local git checkout to push from (default cwd).
  --worktree-dir <path>  Scratch directory for the build (default a temp dir).

Writes pushed and sha to $GITHUB_OUTPUT, or to stdout when that variable is
unset. pushed is "false" when --dest already matched what was asked for.`;

function git(cwd, args, options = {}) {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		...options,
	}).trim();
}

function fetchBranch(repoRoot, remote, branch) {
	const result = spawnSync(
		"git",
		["-C", repoRoot, "fetch", "--quiet", remote, branch],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	return result.status === 0;
}

// Leaves `dir` checked out on a freshly orphaned local branch -- no parent,
// no ref anyone outside this process can see -- with its working tree
// matching the current tip of `branch` if one exists remotely, empty
// otherwise. `git checkout --orphan` inside a worktree that already has files
// keeps those files staged for the next commit; it only detaches history.
function openOrphanWorktree(repoRoot, remote, branch, dir) {
	const found = fetchBranch(repoRoot, remote, branch);
	const previousTree = found
		? git(repoRoot, ["rev-parse", "FETCH_HEAD^{tree}"])
		: EMPTY_TREE_SHA;
	const tmpBranch = `gh-pages-publish-${process.pid}-${Date.now()}`;
	if (found) {
		git(repoRoot, [
			"worktree",
			"add",
			"--detach",
			"--quiet",
			dir,
			"FETCH_HEAD",
		]);
	} else {
		git(repoRoot, [
			"worktree",
			"add",
			"--quiet",
			"--orphan",
			"-b",
			tmpBranch,
			dir,
		]);
	}
	// `core.sparseCheckout` lives in the shared repo config, so a caller whose
	// own checkout is sparse (the preview and cleanup workflows only check out
	// npm-scripts/) hands that restriction to every worktree of that repo too.
	// Left in place, it silently drops any path outside the sparse pattern --
	// most of what a real gh-pages branch holds -- from `git add`. Disabling it
	// here is scoped to this worktree; the caller's own checkout is untouched.
	git(dir, ["sparse-checkout", "disable"]);
	if (found) {
		git(dir, ["checkout", "--quiet", "--orphan", tmpBranch]);
	}
	return { previousTree };
}

function closeWorktree(repoRoot, dir) {
	execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", dir]);
}

function stagedTreeSha(dir) {
	git(dir, ["add", "--all"]);
	return git(dir, ["write-tree"]);
}

function commitOrphanTree(dir, treeSha, message) {
	return git(dir, ["commit-tree", treeSha, "-m", message], {
		env: {
			...process.env,
			GIT_AUTHOR_NAME: BOT_NAME,
			GIT_AUTHOR_EMAIL: BOT_EMAIL,
			GIT_COMMITTER_NAME: BOT_NAME,
			GIT_COMMITTER_EMAIL: BOT_EMAIL,
		},
	});
}

function pushCommit(dir, remote, branch, sha) {
	git(dir, [
		"push",
		"--force",
		"--quiet",
		remote,
		`${sha}:refs/heads/${branch}`,
	]);
}

// Replaces the `dest` subtree of `worktreeDir` with the contents of
// `sourceDir`. `dest` of "." replaces the whole tree except the root entries
// named in `preserve` -- the main-site publish uses this to leave the `pr/`
// directory a preview build wrote untouched.
export function replaceSubtree(worktreeDir, dest, sourceDir, preserve = []) {
	if (dest === ".") {
		for (const entry of readdirSync(worktreeDir)) {
			if (entry === ".git" || preserve.includes(entry)) continue;
			rmSync(join(worktreeDir, entry), { recursive: true, force: true });
		}
		cpSync(sourceDir, worktreeDir, { recursive: true });
		return;
	}
	const target = join(worktreeDir, dest);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	cpSync(sourceDir, target, { recursive: true });
}

// Removes the `dest` subtree of `worktreeDir` entirely. A no-op if it is
// already gone -- cleanup runs for every closed pull request, and most never
// had a preview built.
export function removeSubtree(worktreeDir, dest) {
	rmSync(join(worktreeDir, dest), { recursive: true, force: true });
}

function publishMutation({
	repoRoot,
	remote,
	branch,
	message,
	worktreeDir,
	mutate,
}) {
	const { previousTree } = openOrphanWorktree(
		repoRoot,
		remote,
		branch,
		worktreeDir,
	);
	mutate(worktreeDir);
	const newTree = stagedTreeSha(worktreeDir);
	let pushed = false;
	let sha = null;
	if (newTree !== previousTree) {
		sha = commitOrphanTree(worktreeDir, newTree, message);
		pushCommit(worktreeDir, remote, branch, sha);
		pushed = true;
	}
	closeWorktree(repoRoot, worktreeDir);
	return { pushed, sha };
}

export function publish({
	repoRoot,
	remote = "origin",
	branch = "gh-pages",
	dest,
	sourceDir,
	preserve = [],
	message,
	worktreeDir,
}) {
	return publishMutation({
		repoRoot,
		remote,
		branch,
		message,
		worktreeDir,
		mutate: (dir) => replaceSubtree(dir, dest, sourceDir, preserve),
	});
}

export function remove({
	repoRoot,
	remote = "origin",
	branch = "gh-pages",
	dest,
	message,
	worktreeDir,
}) {
	return publishMutation({
		repoRoot,
		remote,
		branch,
		message,
		worktreeDir,
		mutate: (dir) => removeSubtree(dir, dest),
	});
}

function writeOutputs(entries) {
	const text = `${Object.entries(entries)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")}\n`;
	const file = process.env.GITHUB_OUTPUT;
	if (!file) {
		process.stdout.write(text);
		return;
	}
	appendFileSync(file, text);
}

function fail(message) {
	process.stderr.write(`${message}\n\n${USAGE}\n`);
	process.exit(2);
}

function main(argv) {
	const command = argv[0];
	if (!command || command === "--help" || command === "-h") {
		process.stdout.write(`${USAGE}\n`);
		return;
	}
	if (command !== "publish" && command !== "remove") {
		fail(`unknown command: ${command}`);
	}

	const { values } = parseArgs({
		args: argv.slice(1),
		options: {
			source: { type: "string", default: "" },
			dest: { type: "string", default: "" },
			preserve: { type: "string", multiple: true, default: [] },
			message: { type: "string", default: "" },
			branch: { type: "string", default: "gh-pages" },
			remote: { type: "string", default: "origin" },
			repo: { type: "string", default: process.cwd() },
			"worktree-dir": { type: "string", default: "" },
		},
	});

	if (!values.dest) fail("a --dest is required");
	if (!values.message) fail("a --message is required");
	if (command === "publish" && !values.source) {
		fail("publish requires --source");
	}

	const worktreeDir =
		values["worktree-dir"] || mkdtempSync(join(tmpdir(), "gh-pages-publish-"));

	const result =
		command === "publish"
			? publish({
					repoRoot: values.repo,
					remote: values.remote,
					branch: values.branch,
					dest: values.dest,
					sourceDir: values.source,
					preserve: values.preserve,
					message: values.message,
					worktreeDir,
				})
			: remove({
					repoRoot: values.repo,
					remote: values.remote,
					branch: values.branch,
					dest: values.dest,
					message: values.message,
					worktreeDir,
				});

	writeOutputs({ pushed: String(result.pushed), sha: result.sha ?? "" });
}

if (import.meta.filename === process.argv[1]) {
	main(process.argv.slice(2));
}
