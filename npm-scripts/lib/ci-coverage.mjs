// CI reachability guard. A test that exists but never runs reads as coverage
// while proving nothing, and the only way to notice is to go looking — which is
// how `patches-applied.test.mjs` sat unrun (#146).
//
// Reachability is a graph, not a grep for `npm run`. CI reaches a workflow step;
// a step reaches a script or a file; a script body reaches further scripts and
// files; and a script file reaches whatever it shells out to. Following only
// `npm run` misreads a check that CI already runs as `node npm-scripts/x.mjs` —
// and a guard that under-reports manufactures busywork that looks like rigor,
// which is worse than the hole it replaces.
//
// Three claims are enforced:
//
//   1. every `test:*` and `check:*` script in the root manifest is reached,
//      whether by name or through the file it runs;
//   2. every `test:*` and `check:*` script in a workspace manifest is reached,
//      by a runner that collects it or by an invocation that names its package —
//      the root manifest was the whole guard once, and a suite living in a
//      package was invisible to it (#446);
//   3. every `*.test.mjs` file is either collected by the runner `test:ci`
//      drives or reached directly, so a suite nothing runs is an error.
//
// Claim 2 counts what CI actually collects, not what the runner would collect
// if CI asked for everything. `test:ci` takes a `TEST_EXCLUDE` list from the
// workflow that runs it and drops those packages from the run, so the guard
// reads that list out of the same workflow files it reads the job steps from
// (#448). Seeding the guard with an unexcluded discovery let one word in
// `ci.yml` delete a package's whole suite and still report green — the hole the
// guard exists to close, one level up.
//
// An excluded package is not automatically uncovered: web-client is excluded
// because its suite fans out across the shard matrix, which runs
// `packages/web-client/scripts/test-shard.mjs` rather than `npm run test:run -w`.
// That is coverage by another route, so the guard learns it from the runner file
// CI reaches rather than from an allow-list naming the package. Naming it would
// claim the suite cannot run, which is false, and would re-bury #448 under an
// exemption.
//
// Claim 2 is per package, never per name. `npm run test:unit` reaches whichever
// package the invocation names — `-w`, `--workspace`, or `--prefix`, by
// directory or by package name — and `--workspaces` reaches all of them. An
// invocation that names none reaches the root manifest and stops there. Matching
// on the bare name instead would let one package's wiring excuse every other
// package's script of the same name, which is #446 again with an extra step.
//
// What this proves is wiring, and only wiring. It is textual, so it cannot see
// whether a job's `if:` lets the step run; and it counts a script as covered
// when something invokes it, never asking whether the invocation matches any
// files. `node --test` on a glob that matches nothing exits 0, so a wired
// script that runs no tests satisfies this guard in silence. Reaching for it as
// proof that a suite has tests is a misread — it proves only that a suite with
// tests would have run them.
import { WORKSPACE_SCRIPT } from "./workspace-suites.mjs";

// The script name plus the rest of its command, which is where the flags that
// say *which* package it runs in live. Cut at the first shell separator so a
// second command on the same line cannot lend its `-w` to the first.
const SCRIPT_INVOCATION = /\bnpm run ([\w:.-]+)((?:(?!\bnpm run\b)[^\n])*)/g;
const COMMAND_END = /\s(?:&&|\|\||;|\|)/;
const ALL_WORKSPACES = /\s--workspaces\b/;
const NAMED_WORKSPACE =
	/\s(?:-w|--workspace|--prefix)[\s=]+["']?([\w@/.-]+)["']?/;
const FILE_INVOCATION =
	/\b(?:node|bash|sh|tsx)\s+((?:--?\S+\s+)*[\w./-]+\.(?:mjs|cjs|js|sh)(?:\s+[\w./-]+\.(?:mjs|cjs|js|sh))*)/g;
const FILE_ARGUMENT = /[\w./-]+\.(?:mjs|cjs|js|sh)/g;
// `execFileSync("node", ["npm-scripts/x.mjs"])` is how a script runs another
// script, and the command form above cannot see across the argument array.
const QUOTED_PATH = /["'`]([\w./-]+\.(?:mjs|cjs|js|sh))["'`]/g;
const GUARDED_PREFIXES = ["test:", "check:"];
// The env var `test-parallel.mjs` reads, wherever a workflow sets it. Only a
// literal value is legible: a list built from a repository variable or a matrix
// expression is invisible to a textual guard, and reaches `discoverWorkspaces`
// as a name matching no workspace, which is an error rather than a silent pass.
const TEST_EXCLUDE = /^[^\S\n]*TEST_EXCLUDE:[^\S\n]*(\S.*)$/gm;
// node's own test runner, spawned as an argument. `--test-reporter` and
// `--test-coverage-include` are not it.
const DRIVES_NODE_TEST = /(?:^|[^\w-])--test(?![\w-])/;

// A `#` line in a workflow, or a `//` line in a script, names work without
// running it: `images.yml` documents `npm run images:publish` in its header
// comment. Matching those reports coverage that does not exist.
export function stripComments(text, kind) {
	if (kind === "yaml") {
		return text.replace(/^\s*#.*$/gm, "").replace(/(\s)#.*$/gm, "$1");
	}
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/(\s)\/\/.*$/gm, "$1");
}

// The packages CI hands to `test:ci` as `TEST_EXCLUDE`, read from the workflow
// files rather than taken as an argument so the guard and the runner cannot
// drift — drifting is the failure this closes, not a side effect of it.
//
// The union across every occurrence, because a name CI drops anywhere is a name
// the guard must account for. Two jobs excluding different packages would
// over-report, and that is the safe direction: over-reporting is visible on the
// commit that adds the second job, an unrun suite is not.
export function testExclusions(workflowSources) {
	const names = new Set();
	for (const source of workflowSources) {
		for (const [, value] of stripComments(source, "yaml").matchAll(
			TEST_EXCLUDE,
		)) {
			for (const name of value.replace(/^["']|["']$/g, "").split(",")) {
				if (name.trim()) names.add(name.trim());
			}
		}
	}
	return [...names].sort();
}

// Exclusions the runner was handed that no workflow file declares. The guard
// reads `TEST_EXCLUDE` out of the workflow text, so an exclusion arriving any
// other way — a repository variable, an exported shell var, a composite action
// — is one the guard cannot see, and it would drop a package's whole suite from
// a run that still reports green. Checked in the direction that leaves local
// runs alone: excluding less than the workflows declare is fine, excluding
// something they do not is the hole.
export function undeclaredExclusions(exclude, workflowSources) {
	const declared = new Set(testExclusions(workflowSources));
	return exclude.filter((name) => !declared.has(name));
}

// The packages whose suite a reached runner file runs. A package's tests do not
// have to arrive through `npm run test:run -w <package>`: web-client's arrive
// through the shard matrix, which runs a file inside the package. The file has
// to be reached by CI and has to drive node's test runner, so a build script or
// a coverage merger that happens to sit in the package excuses nothing.
export function workspacesWithReachedRunner({
	workspaces,
	reachedFiles,
	readFile,
}) {
	const covered = new Set();
	for (const file of reachedFiles) {
		const source = readFile(file);
		if (source === null) continue;
		if (!DRIVES_NODE_TEST.test(stripComments(source, "js"))) continue;
		// The innermost package containing the runner owns it.
		const owner = workspaces
			.filter((workspace) => file.startsWith(`${workspace.dir}/`))
			.sort((a, b) => b.dir.length - a.dir.length)[0];
		if (owner) covered.add(owner);
	}
	return [...covered];
}

// Where an `npm run` lands: `"*"` for every workspace, a package's directory or
// name for one of them, and `null` for the manifest the command already sits in.
export function runTarget(rest) {
	const command = rest.split(COMMAND_END)[0];
	if (ALL_WORKSPACES.test(command)) return "*";
	return command.match(NAMED_WORKSPACE)?.[1] ?? null;
}

export function invocations(source) {
	const scripts = new Set();
	const runs = [];
	const files = new Set();
	for (const [, name, rest] of source.matchAll(SCRIPT_INVOCATION)) {
		scripts.add(name);
		runs.push({ name, target: runTarget(rest) });
	}
	// `node --test a.test.mjs b.test.mjs` runs every file it is given, not just
	// the first, so each trailing path counts as reached.
	for (const [, args] of source.matchAll(FILE_INVOCATION)) {
		for (const file of args.match(FILE_ARGUMENT) ?? []) {
			files.add(file.replace(/^\.\//, ""));
		}
	}
	for (const [, file] of source.matchAll(QUOTED_PATH)) {
		files.add(file.replace(/^\.\//, ""));
	}
	return { scripts, runs, files };
}

// Roots are the workflow sources; every script body and script file they reach
// is expanded in turn.
export function reachable({ scripts, workflowSources, readFile }) {
	const reachedScripts = new Set();
	const reachedFiles = new Set();
	// The invocations that cross into the packages, kept with the package each
	// one names: `--workspaces` runs a script the root manifest does not define,
	// and that naming is the only thing that reaches it.
	const workspaceRuns = [];
	const queue = [];

	const visit = ({ scripts: named, runs, files }) => {
		for (const run of runs) {
			if (run.target !== null) workspaceRuns.push(run);
		}
		for (const name of named) {
			if (name in scripts && !reachedScripts.has(name)) {
				reachedScripts.add(name);
				queue.push({ kind: "script", id: name });
			}
		}
		for (const file of files) {
			if (!reachedFiles.has(file)) {
				reachedFiles.add(file);
				queue.push({ kind: "file", id: file });
			}
		}
	};

	for (const source of workflowSources) {
		visit(invocations(stripComments(source, "yaml")));
	}
	while (queue.length > 0) {
		const node = queue.shift();
		if (node.kind === "script") {
			visit(invocations(scripts[node.id]));
			continue;
		}
		const source = readFile(node.id);
		if (source !== null) visit(invocations(stripComments(source, "js")));
	}
	return { reachedScripts, reachedFiles, workspaceRuns };
}

export function isGuarded(name) {
	return GUARDED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// A workspace script is identified by the directory it lives in, so the
// allow-list can name one package's `test:integ` without excusing another's.
export function workspaceScriptId(workspace, name) {
	return `${workspace}#${name}`;
}

export function coverageViolations({
	scripts,
	workspaces = [],
	workflowSources,
	testFiles,
	collectedFiles,
	collectedScripts = [],
	excludedWorkspaces = [],
	readFile = () => null,
	allowUnreachable = {},
}) {
	const violations = [];
	const { reachedScripts, reachedFiles, workspaceRuns } = reachable({
		scripts,
		workflowSources,
		readFile,
	});

	// A script CI never names, whose file CI runs directly, is covered: the
	// script is an alias for work that happens either way.
	const isRootReached = (name) =>
		reachedScripts.has(name) ||
		[...invocations(scripts[name]).files].some((file) =>
			reachedFiles.has(file),
		);

	// Seeded with what the runner behind `test:ci` collects and what CI names,
	// then grown one package at a time: a reached script's body reaches further
	// scripts of that same package, never of any other. drizzle-service's
	// `test:run` reaches its own `test:run:pg`; nobody else acquires one.
	const targets = (workspace) => [workspace.dir, workspace.packageName];
	const isTargeted = (run, workspace) =>
		run.target === "*" || targets(workspace).includes(run.target);

	const excludedSet = new Set(excludedWorkspaces);
	const reachedInWorkspace = new Set(collectedScripts);
	const reach = (workspace, name) => {
		const id = workspaceScriptId(workspace.dir, name);
		if (reachedInWorkspace.has(id)) return false;
		reachedInWorkspace.add(id);
		return true;
	};

	for (const workspace of workspacesWithReachedRunner({
		workspaces,
		reachedFiles,
		readFile,
	})) {
		reach(workspace, WORKSPACE_SCRIPT);
	}
	for (const workspace of workspaces) {
		for (const run of workspaceRuns) {
			if (isTargeted(run, workspace)) reach(workspace, run.name);
		}
	}
	for (let grew = true; grew; ) {
		grew = false;
		for (const workspace of workspaces) {
			for (const [name, body] of Object.entries(workspace.scripts)) {
				const id = workspaceScriptId(workspace.dir, name);
				if (!reachedInWorkspace.has(id)) continue;
				for (const run of invocations(body).runs) {
					// A workspace script's own `npm run x` runs x in that package,
					// unless it names another outright.
					const within =
						run.target === null
							? [workspace]
							: workspaces.filter((other) => isTargeted(run, other));
					for (const target of within) {
						if (reach(target, run.name)) grew = true;
					}
				}
			}
		}
	}

	const entries = [
		...Object.keys(scripts).map((name) => ({
			id: name,
			name,
			reached: () => isRootReached(name),
		})),
		...workspaces.flatMap((workspace) =>
			Object.keys(workspace.scripts).map((name) => ({
				id: workspaceScriptId(workspace.dir, name),
				name,
				excluded:
					name === WORKSPACE_SCRIPT && excludedSet.has(workspace.dir)
						? workspace.dir
						: null,
				reached: () =>
					reachedInWorkspace.has(workspaceScriptId(workspace.dir, name)),
			})),
		),
	];
	const known = new Set(entries.map((entry) => entry.id));

	for (const entry of entries) {
		if (!isGuarded(entry.name)) continue;
		if (entry.reached()) {
			if (entry.id in allowUnreachable) {
				violations.push(
					`script "${entry.id}" is allow-listed as unreachable but CI reaches it: drop the entry`,
				);
			}
			continue;
		}
		// A missing reason is reported once, below, rather than twice here.
		if (entry.id in allowUnreachable) continue;
		// An excluded package's suite reads as wired — `test:ci` is in a job step
		// — while running nowhere, so the message has to name the exclusion or the
		// reader goes looking for a step that is already there (#448).
		if (entry.excluded) {
			violations.push(
				`script "${entry.id}" runs nowhere: TEST_EXCLUDE drops ${entry.excluded} from test:ci and no runner CI reaches runs its tests — take it out of TEST_EXCLUDE, or point a job at a runner inside the package`,
			);
			continue;
		}
		violations.push(
			`script "${entry.id}" is not reached by any workflow: name it in a job step, or drop it`,
		);
	}

	const collectedFileSet = new Set(collectedFiles);
	for (const file of testFiles) {
		if (collectedFileSet.has(file) || reachedFiles.has(file)) continue;
		violations.push(
			`suite "${file}" is collected by no runner: move it where discovery finds it, or drop it`,
		);
	}

	for (const name of Object.keys(allowUnreachable)) {
		if (!known.has(name)) {
			violations.push(
				`script "${name}" is allow-listed as unreachable but no longer exists: drop the entry`,
			);
			continue;
		}
		if (!allowUnreachable[name]) {
			violations.push(`allow-list entry "${name}" needs a reason`);
		}
	}
	return violations.sort();
}
