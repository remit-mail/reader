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
// Two claims are enforced:
//
//   1. every `test:*` and `check:*` script in the root manifest is reached,
//      whether by name or through the file it runs;
//   2. every `*.test.mjs` file is either collected by the runner `test:ci`
//      drives or reached directly, so a suite nothing runs is an error.
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
	const queue = [];

	const visit = ({ scripts: named, files }) => {
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
	return { reachedScripts, reachedFiles };
}

export function isGuarded(name) {
	return GUARDED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function coverageViolations({
	scripts,
	workflowSources,
	testFiles,
	collectedFiles,
	readFile = () => null,
	allowUnreachable = {},
}) {
	const violations = [];
	const { reachedScripts, reachedFiles } = reachable({
		scripts,
		workflowSources,
		readFile,
	});

	// A script CI never names, whose file CI runs directly, is covered: the
	// script is an alias for work that happens either way.
	const isReached = (name) =>
		reachedScripts.has(name) ||
		[...invocations(scripts[name]).files].some((file) =>
			reachedFiles.has(file),
		);

	for (const name of Object.keys(scripts)) {
		if (!isGuarded(name)) continue;
		if (isReached(name)) {
			if (name in allowUnreachable) {
				violations.push(
					`script "${name}" is allow-listed as unreachable but CI reaches it: drop the entry`,
				);
			}
			continue;
		}
		// A missing reason is reported once, below, rather than twice here.
		if (name in allowUnreachable) continue;
		violations.push(
			`script "${name}" is not reached by any workflow: name it in a job step, or drop it`,
		);
	}

	const collected = new Set(collectedFiles);
	for (const file of testFiles) {
		if (collected.has(file) || reachedFiles.has(file)) continue;
		violations.push(
			`suite "${file}" is collected by no runner: move it where discovery finds it, or drop it`,
		);
	}

	for (const name of Object.keys(allowUnreachable)) {
		if (!(name in scripts)) {
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
