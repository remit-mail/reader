// npm-scripts/lib/docs-only.sh — the decision CI trusts when it spares a pull
// request the suites that need a workspace install.
//
// Every test here runs against a real repository, because the flags matter as
// much as the allow-list: a rename or a deletion read the wrong way is a code
// file leaving the tree without anything noticing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LIB = join(HERE, "docs-only.sh");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// The host's own git config is out of scope: a developer's rename threshold or
// commit template must not change what CI decides.
const ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_AUTHOR_NAME: "ci",
	GIT_AUTHOR_EMAIL: "ci@example.invalid",
	GIT_COMMITTER_NAME: "ci",
	GIT_COMMITTER_EMAIL: "ci@example.invalid",
};

function git(dir, ...args) {
	return execFileSync("git", args, { cwd: dir, env: ENV, encoding: "utf8" });
}

function write(dir, path, body) {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), body);
}

function commit(dir, message) {
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", message);
}

// A tree with one of everything the allow-list has an opinion about, so each
// test states only what its own change is.
function seeded() {
	const dir = mkdtempSync(join(TMP_ROOT, "docs-only-"));
	sandboxes.push(dir);
	git(dir, "init", "-q", "-b", "main");
	write(dir, "README.md", "readme\n");
	write(dir, "LICENSE", "licence\n");
	write(dir, "docs/design/mail.md", "design\n");
	write(dir, "packages/app/index.ts", "export const a = 1;\n");
	write(dir, ".github/workflows/ci.yml", "name: CI\n");
	commit(dir, "seed");
	git(dir, "branch", "base");
	return dir;
}

function decide(dir, base = "base", head = "HEAD") {
	return execFileSync("bash", [LIB, base, head], {
		cwd: dir,
		env: ENV,
		encoding: "utf8",
	}).trim();
}

describe("docs-only.sh", () => {
	it("reads a markdown-only change as docs-only", () => {
		const dir = seeded();
		write(dir, "README.md", "readme, revised\n");
		write(dir, "docs/design/mail.md", "design, revised\n");
		commit(dir, "prose");
		assert.equal(decide(dir), "true");
	});

	it("reads licence text as docs-only", () => {
		const dir = seeded();
		write(dir, "LICENSE", "licence, revised\n");
		commit(dir, "licence");
		assert.equal(decide(dir), "true");
	});

	it("reads markdown added anywhere in the tree as docs-only", () => {
		const dir = seeded();
		write(dir, "packages/app/README.md", "how this package works\n");
		commit(dir, "add package readme");
		assert.equal(decide(dir), "true");
	});

	it("reads a deleted doc as docs-only", () => {
		const dir = seeded();
		git(dir, "rm", "-q", "docs/design/mail.md");
		commit(dir, "drop design note");
		assert.equal(decide(dir), "true");
	});

	it("reads a doc renamed to another doc as docs-only", () => {
		const dir = seeded();
		git(dir, "mv", "docs/design/mail.md", "docs/design/mail-list.md");
		commit(dir, "rename design note");
		assert.equal(decide(dir), "true");
	});

	it("reads one source file among the prose as code", () => {
		const dir = seeded();
		write(dir, "README.md", "readme, revised\n");
		write(dir, "packages/app/index.ts", "export const a = 2;\n");
		commit(dir, "prose and code");
		assert.equal(decide(dir), "false");
	});

	it("reads a source-only change as code", () => {
		const dir = seeded();
		write(dir, "packages/app/index.ts", "export const a = 2;\n");
		commit(dir, "code");
		assert.equal(decide(dir), "false");
	});

	it("reads an added source file as code", () => {
		const dir = seeded();
		write(dir, "packages/app/extra.ts", "export const b = 1;\n");
		commit(dir, "add code");
		assert.equal(decide(dir), "false");
	});

	it("reads a deleted source file as code", () => {
		const dir = seeded();
		git(dir, "rm", "-q", "packages/app/index.ts");
		commit(dir, "drop code");
		assert.equal(decide(dir), "false");
	});

	// The case rename detection hides: reported as a single path, this is a doc
	// appearing and nothing else, and the module that left the build is invisible.
	it("reads a source file renamed into docs as code", () => {
		const dir = seeded();
		git(dir, "mv", "packages/app/index.ts", "docs/index.ts");
		commit(dir, "move code into docs");
		assert.equal(decide(dir), "false");
	});

	it("reads a workflow change as code", () => {
		const dir = seeded();
		write(dir, ".github/workflows/ci.yml", "name: CI\non: push\n");
		commit(dir, "ci");
		assert.equal(decide(dir), "false");
	});

	// `docs/` is a directory, never a prefix: a path that merely starts with the
	// same letters is an ordinary source path.
	it("reads a path that only begins with the docs prefix as code", () => {
		const dir = seeded();
		write(dir, "docsite/build.ts", "export const c = 1;\n");
		commit(dir, "add docsite");
		assert.equal(decide(dir), "false");
	});

	it("reads a range with no changes as code", () => {
		const dir = seeded();
		assert.equal(decide(dir), "false");
	});

	// Three-dot: the answer is about what the branch adds, so code landing on the
	// base branch after the branch point is somebody else's change.
	it("ignores what the base branch gained after the branch point", () => {
		const dir = seeded();
		write(dir, "docs/design/mail.md", "design, revised\n");
		commit(dir, "prose");
		git(dir, "checkout", "-q", "base");
		write(dir, "packages/app/index.ts", "export const a = 3;\n");
		commit(dir, "unrelated code on base");
		git(dir, "checkout", "-q", "main");
		assert.equal(decide(dir), "true");
	});
});
