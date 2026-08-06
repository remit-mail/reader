// The startup contract every stack this repo brings up with `docker compose up
// --wait` has to satisfy.
//
// `--wait` gates on each service reaching running-or-healthy. A service that
// declares no healthcheck at all is fine — compose falls back to "running" for
// it. A service that declares `healthcheck: disable: true` is not: the container
// config then carries a healthcheck of NONE, compose stops applying the
// fallback, finds no health state to read, and fails the whole `up` with
// "container <name> has no healthcheck configured". Nothing is unhealthy and
// nothing is slow; the command simply refuses to return, and the suite behind it
// never runs.
//
// Asserted against what `docker compose config` resolves, over the file sets the
// scripts below pass to `up --wait`, and with every profile on: a service moved
// behind a profile reads the same to a regex and not to compose.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	CLEAN_ENV,
	COMPOSE_OK,
	cleanupSandboxes,
	DEPLOY,
	ROOT,
	sandbox,
} from "./compose-fixture.mjs";

after(cleanupSandboxes);

// The e2e stack configures itself from the committed e2e.env, plus the one line
// npm-scripts/e2e-compose.sh appends. Reading those files rather than restating
// them keeps this measuring the stack the lane really starts.
const e2eEnv = () =>
	[
		readFileSync(join(DEPLOY, "e2e.env"), "utf8"),
		`REMIT_DEPLOY_DIR=${DEPLOY}`,
	].join("\n");

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

// Where those three live. A fourth `--wait` added anywhere fails the inventory
// test below rather than quietly going uncovered.
const WAIT_CALLERS = [
	"npm-scripts/e2e-up.sh",
	"npm-scripts/e2e-dev-up.sh",
	"package.json",
];

// Resolved in a sandbox holding the compose files and one env file, because
// every app service takes `env_file: .env` and compose refuses to resolve a
// stack whose env file is absent — which is the state of a checkout.
const resolve = (stack) => {
	const dir = sandbox("compose-wait");
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
		"--profile",
		"*",
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
				`\`docker compose up --wait\` fails outright on a disabled healthcheck, so ${disabled.join(", ")} would stop this stack from ever reporting started. Give the service a check it can pass, or drop the healthcheck key so compose waits for running instead.`,
			);
		});
	}

	// The list above is hand-written, so this is what keeps it honest: the search
	// is over the tree, and a `--wait` in a file nobody listed fails here naming
	// the file.
	it("covers every --wait in the tree", () => {
		const found = spawnSync(
			"git",
			["grep", "-l", "--", "^[^#]*up .*--wait", "--", ":!npm-scripts/lib"],
			{ cwd: ROOT, encoding: "utf8", env: CLEAN_ENV },
		);
		assert.equal(found.status, 0, found.stderr);
		assert.deepEqual(
			found.stdout.split("\n").filter(Boolean).sort(),
			[...WAIT_CALLERS].sort(),
			"a stack brought up with --wait and not listed in WAITED_STACKS is a stack this suite does not check",
		);
	});

	// The guard above is only worth what its detector is worth. This proves the
	// detector fires on the shape that broke the lane, resolved by compose from
	// the same syntax the deployment file used.
	it("recognises a disabled healthcheck the way compose resolves one", () => {
		const file = join(sandbox("compose-wait-probe"), "docker-compose.yml");
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
