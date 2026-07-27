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

	const reachedInWorkspace = new Set(collectedScripts);
	const reach = (workspace, name) => {
		const id = workspaceScriptId(workspace.dir, name);
		if (reachedInWorkspace.has(id)) return false;
		reachedInWorkspace.add(id);
		return true;
	};

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
