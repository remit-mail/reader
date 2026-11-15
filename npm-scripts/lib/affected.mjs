// Which side of the tree a change reaches, read off the workspace dependency
// graph, for the CI job that spares a pull request the suites it cannot break.
//
// A workspace is frontend when it depends on a UI runtime, and backend when it
// does not or when it carries a `test:run` suite, because that suite runs in
// the backend job whatever the package renders. A change reaches every
// workspace that depends on what it touched, transitively. A path outside every
// workspace (TypeSpec, the generated clients, root config, the lockfile, CI)
// is shared and reaches both sides, as does a path under a directory that is
// no longer a workspace: a deleted package's dependents cannot be read.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const UI_RUNTIMES = ["react-dom", "preact"];
export const BACKEND_SUITE = "test:run";

export function describeWorkspace(dir, manifest) {
	const deps = {
		...manifest.dependencies,
		...manifest.devDependencies,
		...manifest.peerDependencies,
	};
	const frontend = UI_RUNTIMES.some((runtime) => runtime in deps);
	return {
		name: manifest.name,
		dir,
		deps: Object.keys(deps),
		frontend,
		backend: !frontend || Boolean(manifest.scripts?.[BACKEND_SUITE]),
	};
}

export async function readWorkspaces(root) {
	const manifest = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	);
	const workspaces = [];
	for (const pattern of manifest.workspaces) {
		if (!pattern.endsWith("/*")) {
			throw new Error(`unsupported workspace pattern: ${pattern}`);
		}
		const parent = pattern.slice(0, -2);
		for (const entry of await readdir(join(root, parent), {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) continue;
			const dir = `${parent}/${entry.name}`;
			const text = await readFile(
				join(root, dir, "package.json"),
				"utf8",
			).catch((error) => {
				if (error.code === "ENOENT") return null;
				throw error;
			});
			if (text === null) continue;
			workspaces.push(describeWorkspace(dir, JSON.parse(text)));
		}
	}
	return workspaces;
}

export function affected(workspaces, changed) {
	const byName = new Map(workspaces.map((w) => [w.name, w]));
	const dependents = new Map(workspaces.map((w) => [w.name, []]));
	for (const w of workspaces) {
		for (const dep of w.deps) dependents.get(dep)?.push(w.name);
	}

	const owner = (path) =>
		workspaces.find((w) => path.startsWith(`${w.dir}/`))?.name ?? null;

	const shared = [];
	const reached = new Set();
	const stack = [];
	for (const path of changed) {
		const name = owner(path);
		if (name === null) {
			shared.push(path);
			continue;
		}
		stack.push(name);
	}
	while (stack.length > 0) {
		const name = stack.pop();
		if (reached.has(name)) continue;
		reached.add(name);
		stack.push(...dependents.get(name));
	}

	const sides = [...reached].map((name) => byName.get(name));
	const everything = shared.length > 0 || changed.length === 0;
	return {
		frontend: everything || sides.some((w) => w.frontend),
		backend: everything || sides.some((w) => w.backend),
		shared,
		reached: [...reached].sort(),
	};
}
