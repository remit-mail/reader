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
//      either by a runner that collects it or by name — the root manifest was
//      the whole guard once, and a suite living in a package was invisible to
//      it (#446);
//   3. every `*.test.mjs` file is either collected by the runner `test:ci`
//      drives or reached directly, so a suite nothing runs is an error.
//
// A workspace script is matched by name alone, because that is how the
// invocations that reach one are written: `npm run test:typecheck --workspaces`
// names no package, and a script that cds into its own directory names none
// either. Two packages sharing a script name therefore stand or fall together.
//
// Reachability is textual, so it proves wiring rather than that a job's
// conditions let it run. The wiring is the part people forget.
const SCRIPT_INVOCATION = /\bnpm run ([\w:.-]+)/g;
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

export function invocations(source) {
	const scripts = new Set();
	const files = new Set();
	for (const [, name] of source.matchAll(SCRIPT_INVOCATION)) scripts.add(name);
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
	return { scripts, files };
}

// Roots are the workflow sources; every script body and script file they reach
// is expanded in turn.
export function reachable({ scripts, workflowSources, readFile }) {
	const reachedScripts = new Set();
	const reachedFiles = new Set();
	// Every script name an expanded source invokes, whether or not the root
	// manifest defines it. `npm run test:typecheck --workspaces` names a script
	// that exists only in the packages, and that naming is what reaches them.
	const namedScripts = new Set();
	const queue = [];

	const visit = ({ scripts: named, files }) => {
		for (const name of named) {
			namedScripts.add(name);
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
	return { reachedScripts, reachedFiles, namedScripts };
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
	workspaceScripts = {},
	workflowSources,
	testFiles,
	collectedFiles,
	collectedScripts = [],
	readFile = () => null,
	allowUnreachable = {},
}) {
	const violations = [];
	const { reachedScripts, reachedFiles, namedScripts } = reachable({
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

	const collected = new Set(collectedScripts);
	const isWorkspaceReached = (workspace, name) =>
		collected.has(workspaceScriptId(workspace, name)) || namedScripts.has(name);

	// A reached workspace script names further scripts of its own — the split
	// dialect runs in drizzle-service are `test:run:pg` and `test:run:sqlite`,
	// reached by nothing but the `test:run` the runner collects. Expanded to a
	// fixpoint so a chain of them is followed, not just the first link.
	for (let grew = true; grew; ) {
		grew = false;
		for (const [workspace, manifest] of Object.entries(workspaceScripts)) {
			for (const [name, body] of Object.entries(manifest)) {
				if (!isWorkspaceReached(workspace, name)) continue;
				for (const next of invocations(body).scripts) {
					if (namedScripts.has(next)) continue;
					namedScripts.add(next);
					grew = true;
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
		...Object.entries(workspaceScripts).flatMap(([workspace, manifest]) =>
			Object.keys(manifest).map((name) => ({
				id: workspaceScriptId(workspace, name),
				name,
				reached: () => isWorkspaceReached(workspace, name),
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
