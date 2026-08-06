// The startup contract every stack this repo brings up with `docker compose up
// --wait` has to satisfy.
//
// `--wait` gates on each service reaching running-or-healthy. A service that
// declares no healthcheck at all is fine — compose falls back to "running" for
// it. A service that declares `healthcheck: disable: true` is not: the
// container config then carries a healthcheck of NONE, compose stops applying
// the fallback, finds no health state to read, and fails the whole `up` with
// "container <name> has no healthcheck configured". Nothing is unhealthy and
// nothing is slow; the command simply refuses to return.
//
// That is what happened to the packaged e2e lane (reader#644). The scheduler
// landed with a disabled check, the lane runs on a 04:00 schedule and on manual
// dispatch and never on merge, and the suite stopped running for a day while
// the job reported a startup error nobody was looking at. The cost of the shape
// is not that it is wrong once — it is that the stack it breaks is the one
// carrying the tests.
//
// So this suite runs on every pull request and asserts against what
// `docker compose config` resolves, over exactly the file sets and profiles the
// scripts below pass to `up --wait`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// A missing tool is a fact about a developer's machine and never about CI:
// skipping there would leave a suite that reports green without having resolved
// anything.
const COMPOSE_OK = (() => {
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
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

// The e2e stack configures itself from the committed e2e.env, plus the one line
// npm-scripts/e2e-compose.sh appends. Reading those files rather than restating
// them keeps this measuring the stack the lane really starts.
const e2eEnv = () =>
	[
		readFileSync(join(DEPLOY, "e2e.env"), "utf8"),
		`REMIT_DEPLOY_DIR=${DEPLOY}`,
	].join("\n");

// Every `docker compose up --wait` in this repo, and the files it passes. A
// fourth one added without a line here is a stack this suite does not cover.
const WAITED_STACKS = [
	{
		name: "the packaged e2e stack (npm run e2e:up)",
		env: e2eEnv,
		envFile: ".env",
		from: DEPLOY,
		files: [
			"docker-compose.sqlite.yml",
			"docker-compose.dovecot.yml",
			"docker-compose.e2e.yml",
		],
	},
	{
		name: "the source-built lane's dovecot (npm run e2e:dev:up)",
		env: e2eEnv,
		envFile: ".env",
		from: DEPLOY,
		files: ["docker-compose.dovecot.yml"],
	},
	{
		name: "the localhost dev stack (npm run dev:sqlite)",
		env: () => readFileSync(join(ROOT, "localhost-dev-sqlite.env"), "utf8"),
		envFile: "localhost-dev-sqlite.env",
		from: ROOT,
		files: ["docker-compose.localhost-dev-sqlite.yml"],
	},
];

// Resolved in a sandbox holding the compose files and one .env, because every
// app service takes `env_file: .env` and compose refuses to resolve a stack
// whose env file is absent — which is exactly the state a checkout is in.
const resolve = (stack) => {
	const dir = mkdtempSync(join(TMP_ROOT, "compose-wait-"));
	sandboxes.push(dir);
	writeFileSync(join(dir, stack.envFile), `${stack.env()}\n`);
	const args = ["compose"];
	for (const file of stack.files) {
		copyFileSync(join(stack.from, file), join(dir, file));
		args.push("-f", join(dir, file));
	}
	args.push(
		"--project-directory",
		dir,
		"--env-file",
		join(dir, stack.envFile),
		"config",
		"--format",
		"json",
	);
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		env: CLEAN_ENV,
	});
	assert.equal(
		result.status,
		0,
		`docker compose config failed: ${result.stderr || result.stdout}`,
	);
	return JSON.parse(result.stdout);
};

// Both spellings of the same container config. `disable: true` is what compose
// resolves a disabled check to; ["NONE"] is what a compose file can write by
// hand and what the container ends up carrying either way.
const isDisabled = (healthcheck) =>
	healthcheck !== undefined &&
	(healthcheck.disable === true ||
		(healthcheck.test?.length === 1 && healthcheck.test[0] === "NONE"));

describe("every stack started with --wait can finish starting", {
	skip: !COMPOSE_OK,
}, () => {
	for (const stack of WAITED_STACKS) {
		it(`has no service that disables its healthcheck: ${stack.name}`, () => {
			const disabled = Object.entries(resolve(stack).services)
				.filter(([, service]) => isDisabled(service.healthcheck))
				.map(([name]) => name);
			assert.deepEqual(
				disabled,
				[],
				`\`docker compose up --wait\` fails outright on a disabled healthcheck, so ${disabled.join(", ")} would stop this stack from ever reporting started. Give the service a check it can pass, or remove the healthcheck key so compose waits for running instead.`,
			);
		});
	}

	// The guard above is only worth what its detector is worth. This proves the
	// detector fires on the shape that broke the lane, resolved by compose from
	// the same syntax the deployment file used.
	it("recognises a disabled healthcheck the way compose resolves one", () => {
		const dir = mkdtempSync(join(TMP_ROOT, "compose-wait-probe-"));
		sandboxes.push(dir);
		const file = join(dir, "docker-compose.yml");
		writeFileSync(
			file,
			[
				"services:",
				"  off:",
				"    image: alpine:3.23",
				"    healthcheck:",
				"      disable: true",
				"  on:",
				"    image: alpine:3.23",
				'    healthcheck:\n      test: ["CMD", "true"]',
				"  none:",
				"    image: alpine:3.23",
				"",
			].join("\n"),
		);
		const result = spawnSync(
			"docker",
			["compose", "-f", file, "config", "--format", "json"],
			{ encoding: "utf8", env: CLEAN_ENV },
		);
		assert.equal(result.status, 0, result.stderr);
		const { services } = JSON.parse(result.stdout);
		assert.equal(isDisabled(services.off.healthcheck), true);
		assert.equal(isDisabled(services.on.healthcheck), false);
		assert.equal(isDisabled(services.none.healthcheck), false);
	});
});
