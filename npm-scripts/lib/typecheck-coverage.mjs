// Typecheck reachability guard (#440) — the decisions, with no filesystem and no
// `typescript` import, so the install-free `validate` job can test them.
// check-typecheck-coverage.mjs supplies the tree and the config expansion.
//
// `npm run typecheck` is `npm run test:typecheck --workspaces --if-present`, and
// the workspaces are `packages/*`. Being a package is therefore the whole gate:
// a `.ts` file anywhere else is compiled by nothing, and a hard type error in it
// reaches a released artifact with the gate still green. That is not
// hypothetical — the self-host migrator shipped two `TS2349`s and died at
// runtime after applying the schema migrations, because it lived under
// `deploy/` (#389).
//
// Widening one package's `include` to reach across the tree fixes one file and
// leaves the category open. The claim asserted instead is the category: every
// TypeScript file the repository tracks is in the compilation of some package
// whose `test:typecheck` runs the config that reaches it.

// A step counts only when it is the command being run — `tsgo`/`tsc` as the
// first word, optionally through `npx`. A step that merely mentions the name
// (`node tsc-report.mjs`) compiles nothing, and a step whose failure is
// swallowed (`tsgo --noEmit || true`) enforces nothing; crediting either would
// report a hole as covered, which is the one thing this file must not do.
const STEP_RUNS_TSC = /^(?:npx\s+(?:--\S+\s+)*)?(?:tsgo|tsc)(?:\s|$)/;
const PROJECT_FLAG = /\s(?:-p|--project)[\s=]+(\S+)/;

export function projectsOf(script) {
	const projects = [];
	for (const step of script.split("&&")) {
		const command = step.trim();
		if (command.includes("||")) continue;
		if (!STEP_RUNS_TSC.test(command)) continue;
		const project = command.match(PROJECT_FLAG);
		projects.push(project ? project[1] : "tsconfig.json");
	}
	return [...new Set(projects)];
}

// A file in no workspace at all. `npm run typecheck` never reaches it, whatever
// any tsconfig says.
export function strayFiles(files) {
	return files.filter((file) => !file.startsWith("packages/"));
}

// A file inside a package that no compiled config lists. Usually a too-narrow
// `include`; on a package that has moved to `tsc -b` project references it means
// something else, because a solution-style config (`"files": []` plus
// `references`) expands to nothing on its own — that package needs its
// referenced configs named on `test:typecheck` too.
export function uncoveredFiles(files, covered) {
	const reached = new Set(covered);
	return files.filter((file) => !reached.has(file));
}
