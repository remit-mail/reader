// Shared by the suites that assert against what `docker compose config`
// resolves, so the rule about a missing tool is written once. One walk of the
// same decisions in two files drifts; this is the same argument test-suites.mjs
// makes about the list of suites.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEPLOY = join(ROOT, "deploy", "vps");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const sandboxes = [];

export const sandbox = (prefix) => {
	const dir = mkdtempSync(join(TMP_ROOT, `${prefix}-`));
	sandboxes.push(dir);
	return dir;
};

/** A path under .tmp that deliberately does not exist. */
export const absentPath = (name) => join(TMP_ROOT, name);

export const cleanupSandboxes = () => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
	sandboxes.length = 0;
};

// A missing tool is a fact about a developer's machine and never about CI:
// skipping there would leave a suite that reports green without having resolved
// anything.
export const COMPOSE_OK = (() => {
	if (
		spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status ===
		0
	) {
		return true;
	}
	if (process.env.CI)
		throw new Error(
			"no `docker compose` on this machine — this suite needs it",
		);
	console.log("skipping: no `docker compose` on this machine");
	return false;
})();

// Compose reads the process environment as well as --env-file, and the ambient
// one would decide the answer on some machines and not others.
export const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };
