#!/usr/bin/env node
// Publishes a built directory into a subtree of the `gh-pages` branch as a
// single orphan commit, force-pushed. Shared by every workflow that writes to
// that branch (the main-site publish, a per-PR preview publish, and preview
// cleanup) so the branch never grows without bound and a push either lands
// whole or not at all -- there is no partial state to observe mid-push.
//
// The branch is rebuilt from its own current tip each time (via a detached
// worktree), so nothing already on the branch is lost by starting fresh:
// `publish` overwrites only `--dest` (and, given `--nest`, only the sha named
// by it under `--dest`) and leaves the rest of the tree exactly as it was;
// `remove` deletes only `--dest`.
//
// Three workflows can write to this branch around the same time (a push to
// main, a PR preview publish, a PR close). A shared concurrency group across
// them is an optimization, not the correctness guarantee: GitHub only holds
// one running and one pending job per group, so a third arrival still bumps
// the pending one. Correctness instead comes from `git push
// --force-with-lease`: each attempt stakes its push on the exact commit it
// read, a lost race is rejected rather than silently overwritten, and the
// caller retries against the branch's new tip.
import { execFileSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL =
	"41898282+github-actions[bot]@users.noreply.github.com";
export const MAX_PUSH_ATTEMPTS = 5;

// Written at the branch root on every publish and every removal, regardless
// of `--dest`: this PR runs Pages as a Jekyll (`build_type: legacy`) build,
// and Jekyll silently drops any file or directory starting with `_` or `.`
// -- Vite's commonjs interop emits `_commonjsHelpers-<hash>.js` the moment a
// dependency needs it. `actions/upload-artifact` excludes hidden files by
// default, so this can never ride in through a build's own output; it has to
// be written directly onto the branch.
const NOJEKYLL = ".nojekyll";

// Preserved by a root (`--dest "."`) publish in addition to whatever the
// caller passes as `--preserve`: `.nojekyll` is regenerated unconditionally
// below regardless, and `CNAME` is a custom-domain file this script has no
// content to reconstruct once deleted.
const ALWAYS_PRESERVED_ROOT_ENTRIES = [NOJEKYLL, "CNAME"];

const USAGE = `usage: gh-pages-publish.mjs <command> [options]

Commands:
  publish  Replace --dest on the branch with the contents of --source.
  remove   Delete --dest from the branch.

Options:
  --dest <path>          Subtree to write or delete. "." means the branch root.
  --source <dir>         Directory to publish (publish only).
  --nest <name>          Publish --source under --dest/--nest, replacing every
                          other entry under --dest (publish only). Use this to
                          replace a PR's whole pr/<n>/ with just the sha being
                          published, instead of accumulating one copy per tick.
  --preserve <path>      Root entry to leave untouched (publish, --dest ".", repeatable).
  --message <text>       Commit message for the orphan commit.
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
// Returns the commit `branch` currently points to remotely (or "" if it does
// not exist yet), which the caller stakes its `--force-with-lease` push on.
function openOrphanWorktree(repoRoot, remote, branch, dir) {
	const found = fetchBranch(repoRoot, remote, branch);
	const previousCommit = found
		? git(repoRoot, ["rev-parse", "FETCH_HEAD"])
		: "";
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
	return { previousTree, previousCommit };
}

function closeWorktree(repoRoot, dir) {
	execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", dir]);
}

function stagedTreeSha(dir) {
	// --force: a `.gitignore` or `.git/info/exclude`-matching file that arrives
	// in the published payload must still land on the branch. Without it, a
	// build output that happens to ship a `.gitignore` silently drops whatever
	// it excludes from every future publish, forever, once that first commit
	// lands.
	git(dir, ["add", "--all", "--force"]);
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

// True when `git push --force-with-lease` was rejected because the branch
// moved since it was read, rather than for some other reason (auth, network,
// a protected branch). Only this kind of failure is worth retrying.
export function isLeaseRejection(stderr) {
	return (
		/\[rejected\]/.test(stderr) &&
		/\((stale info|fetch first|already exists)\)/.test(stderr)
	);
}

// The bare `--force-with-lease` form compares against
// `refs/remotes/<remote>/<branch>`, which is only written by a fetch that
// names that ref explicitly. `fetchBranch` above fetches `branch` into
// `FETCH_HEAD` instead (there is no local tracking branch to keep in sync),
// so the lease has to be spelled out against the exact commit read: empty
// means the ref must not exist yet, matching the bootstrap case.
function pushCommitWithLease(dir, remote, branch, sha, previousCommit) {
	try {
		git(dir, [
			"push",
			`--force-with-lease=refs/heads/${branch}:${previousCommit}`,
			"--quiet",
			remote,
			`${sha}:refs/heads/${branch}`,
		]);
	} catch (error) {
		error.isLeaseRejection = isLeaseRejection(String(error.stderr ?? ""));
		throw error;
	}
}

// Replaces the `dest` subtree of `worktreeDir` with the contents of
// `sourceDir`. `dest` of "." replaces the whole tree except `.nojekyll`,
// `CNAME`, and the root entries named in `preserve` -- the main-site publish
// uses `preserve` to leave the `pr/` directory a preview build wrote
// untouched. Given `nest`, `sourceDir` lands at `dest/nest` and every other
// entry under `dest` is removed -- a preview publish uses this so retiring a
// commit's preview does not leave the previous commit's copy behind.
//
// Always leaves `.nojekyll` at the worktree root regardless of `dest`, even
// for a nested preview publish that never touches the root otherwise -- a
// publish is exactly when the branch gains real content for Jekyll to trip
// over, including the very first one, before any root publish has ever run.
// `remove` below does not write it: removing a preview touches nothing at
// the root, and a cleanup for a PR that was never previewed must stay a true
// no-op rather than bootstrapping the branch just to hold this file.
export function replaceSubtree(
	worktreeDir,
	dest,
	sourceDir,
	preserve = [],
	nest = "",
) {
	if (dest === ".") {
		const keep = new Set([...preserve, ...ALWAYS_PRESERVED_ROOT_ENTRIES]);
		for (const entry of readdirSync(worktreeDir)) {
			if (entry === ".git" || keep.has(entry)) continue;
			rmSync(join(worktreeDir, entry), { recursive: true, force: true });
		}
		cpSync(sourceDir, worktreeDir, { recursive: true });
	} else {
		const target = join(worktreeDir, dest);
		rmSync(target, { recursive: true, force: true });
		const finalTarget = nest ? join(target, nest) : target;
		mkdirSync(finalTarget, { recursive: true });
		cpSync(sourceDir, finalTarget, { recursive: true });
	}
	writeFileSync(join(worktreeDir, NOJEKYLL), "");
}

// Removes the `dest` subtree of `worktreeDir` entirely. A no-op if it is
// already gone -- cleanup runs for every closed pull request, and most never
// had a preview built.
export function removeSubtree(worktreeDir, dest) {
	rmSync(join(worktreeDir, dest), { recursive: true, force: true });
}

// The worktree is always removed before returning -- including when the push
// throws a (possibly retryable) lease rejection -- so a retry can reopen the
// same `worktreeDir` path instead of colliding with a worktree git still has
// registered there.
function publishOnce({
	repoRoot,
	remote,
	branch,
	message,
	worktreeDir,
	mutate,
}) {
	const { previousTree, previousCommit } = openOrphanWorktree(
		repoRoot,
		remote,
		branch,
		worktreeDir,
	);
	try {
		mutate(worktreeDir);
		const newTree = stagedTreeSha(worktreeDir);
		if (newTree === previousTree) {
			return { pushed: false, sha: null };
		}
		const sha = commitOrphanTree(worktreeDir, newTree, message);
		pushCommitWithLease(worktreeDir, remote, branch, sha, previousCommit);
		return { pushed: true, sha };
	} finally {
		closeWorktree(repoRoot, worktreeDir);
	}
}

// Retries the whole fetch -> mutate -> commit -> push cycle when the push
// lost a race, each time re-reading the branch's current tip so the retry's
// commit is built on top of whatever landed in between -- not just this
// process's own idea of what the tree looked like a moment ago. `_racer`
// exists only for tests: called once per attempt right before the push, it
// simulates a second publisher landing in that same window.
function publishMutation({
	repoRoot,
	remote,
	branch,
	message,
	worktreeDir,
	mutate,
	maxAttempts = MAX_PUSH_ATTEMPTS,
	_racer,
}) {
	let lastError;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return publishOnce({
				repoRoot,
				remote,
				branch,
				message,
				worktreeDir,
				mutate: (dir) => {
					mutate(dir);
					if (_racer) _racer(attempt);
				},
			});
		} catch (error) {
			if (!error.isLeaseRejection) throw error;
			lastError = error;
		}
	}
	throw new Error(
		`gh-pages-publish: gave up after ${maxAttempts} attempts racing another push to ${branch}: ${lastError.message}`,
	);
}

export function publish({
	repoRoot,
	remote = "origin",
	branch = "gh-pages",
	dest,
	sourceDir,
	preserve = [],
	nest = "",
	message,
	worktreeDir,
	maxAttempts,
	_racer,
}) {
	return publishMutation({
		repoRoot,
		remote,
		branch,
		message,
		worktreeDir,
		maxAttempts,
		_racer,
		mutate: (dir) => replaceSubtree(dir, dest, sourceDir, preserve, nest),
	});
}

export function remove({
	repoRoot,
	remote = "origin",
	branch = "gh-pages",
	dest,
	message,
	worktreeDir,
	maxAttempts,
	_racer,
}) {
	return publishMutation({
		repoRoot,
		remote,
		branch,
		message,
		worktreeDir,
		maxAttempts,
		_racer,
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
			nest: { type: "string", default: "" },
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
					nest: values.nest,
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
