// install.sh --project: a second deployment on one host (reader#567 D14).
//
// Driven the way the tunnel suite drives it — a real bash run against a local
// asset base, a container-engine stand-in, and a PATH holding nothing else — so
// what is asserted is the deployment an operator ends up with: which .env, which
// directory, which wrapper, and which project the installer looks for containers
// under.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const INSTALL = join(ROOT, "install.sh");
const DEPLOY = join(ROOT, "deploy", "vps");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const ORIGIN = "https://mail.example.test";

const PASSTHROUGH = [
	"awk",
	"basename",
	"cat",
	"chmod",
	"chown",
	"cmp",
	"cp",
	"curl",
	"cut",
	"date",
	"dirname",
	"env",
	"expr",
	"grep",
	"head",
	"id",
	"ln",
	"ls",
	"mkdir",
	"mv",
	"od",
	"openssl",
	"printf",
	"rm",
	"sed",
	"sh",
	"sleep",
	"sort",
	"stat",
	"sync",
	"tail",
	"touch",
	"tr",
	"uname",
	"wc",
];

const realPath = (name) => {
	const found = spawnSync("sh", ["-c", `command -v ${name}`], {
		encoding: "utf8",
	});
	return found.status === 0 ? found.stdout.trim() : null;
};

const BASH = realPath("bash") ?? "/bin/bash";

const script = (path, body) => {
	writeFileSync(path, body);
	chmodSync(path, 0o755);
};

const RECORD = [
	"{",
	"\tprintf '%s' \"$0\"",
	'\tfor _a in "$@"; do printf \' %s\' "$_a"; done',
	"\tprintf '\\n'",
	'} >>"$REMIT_ARGV_LOG"',
].join("\n");

// Answers what install.sh asks of a container engine and records every call, so
// the project the installer scopes its questions to is readable afterwards.
const FAKE_DOCKER = `#!/bin/sh
${RECORD}
if [ "\${1:-}" = "compose" ]; then
	shift
	_sub=""
	while [ $# -gt 0 ]; do
		case "$1" in
		--env-file | -f | --project-directory | --profile) shift 2 ;;
		-*) shift ;;
		*) _sub=$1; break ;;
		esac
	done
	case "$_sub" in
	version) printf 'Docker Compose version v2.40.3\\n' ;;
	esac
	exit 0
fi
case "\${1:-}" in
info) printf 'Server Version: 27.5.1\\n' ;;
esac
exit 0
`;

const STUB_REMIT = `#!/bin/sh
case "\${1:-}" in
probe-host) printf 'held 198.51.100.7\\n' ;;
update) printf 'stub: images pulled, stack started\\n' ;;
esac
exit 0
`;

// `stubWrapper: false` keeps the shipped remit, for the assertions about what
// the installer rewrites into it. Those runs are --dry-run: the real wrapper
// would otherwise be handed a stack to start.
function sandbox({ stubWrapper = true } = {}) {
	const root = mkdtempSync(join(TMP_ROOT, "install-project-"));
	sandboxes.push(root);
	const bin = join(root, "bin");
	const assets = join(root, "assets");
	const bindir = join(root, "usrbin");
	const cwd = join(root, "cwd");
	const argvLog = join(root, "argv.log");
	for (const d of [bin, bindir, cwd]) mkdirSync(d, { recursive: true });
	writeFileSync(argvLog, "");

	cpSync(DEPLOY, assets, { recursive: true });
	if (stubWrapper) script(join(assets, "remit"), STUB_REMIT);

	script(join(bin, "docker"), FAKE_DOCKER);
	for (const name of PASSTHROUGH) {
		const real = realPath(name);
		if (!real) continue;
		script(join(bin, name), `#!/bin/sh\n${RECORD}\nexec ${real} "$@"\n`);
	}

	return {
		cwd,
		bindir,
		onPath: () => readdirSync(bindir).sort(),
		run(args, env = {}) {
			const result = spawnSync(BASH, [INSTALL, ...args], {
				cwd,
				encoding: "utf8",
				env: {
					PATH: bin,
					HOME: root,
					REMIT_ASSET_BASE: assets,
					REMIT_BINDIR: bindir,
					REMIT_ARGV_LOG: argvLog,
					...env,
				},
			});
			return {
				...result,
				output: `${result.stdout}${result.stderr}`,
				argv: readFileSync(argvLog, "utf8"),
				value: (key, dir) =>
					readFileSync(join(dir, ".env"), "utf8")
						.split("\n")
						.filter((line) => line.startsWith(`${key}=`))
						.map((line) => line.slice(key.length + 1)),
			};
		},
	};
}

const baseArgs = ["--origin", ORIGIN, "--dry-run"];

describe("a deployment states its own compose project", () => {
	it("is the default one when nothing says otherwise", () => {
		const box = sandbox();
		const run = box.run([...baseArgs, "--dir", join(box.cwd, "reader")]);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("REMIT_PROJECT", join(box.cwd, "reader")), [
			"remit",
		]);
	});

	it("is the one --project names", () => {
		const box = sandbox();
		const dir = join(box.cwd, "beta");
		const run = box.run([...baseArgs, "--project", "beta", "--dir", dir]);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("REMIT_PROJECT", dir), ["beta"]);
	});

	it("installs into a directory of its own by default", () => {
		const box = sandbox();
		const run = box.run([...baseArgs, "--project", "beta"]);
		assert.equal(run.status, 0, run.output);
		assert.ok(
			existsSync(join(box.cwd, "reader-beta", ".env")),
			`nothing installed at reader-beta:\n${run.output}`,
		);
		assert.ok(
			!existsSync(join(box.cwd, "reader")),
			"a second deployment must not default into the first one's directory",
		);
	});

	it("takes a name compose can carry, and nothing else", () => {
		for (const name of ["Beta", "-beta", "be ta", "beta/one"]) {
			const box = sandbox();
			const run = box.run([...baseArgs, "--project", name]);
			assert.notEqual(run.status, 0, `--project ${name} was accepted`);
			assert.match(run.stderr, /--project/);
		}
	});

	it("refuses an empty name rather than installing the default deployment", () => {
		// `--project "$SOMETHING"` that expanded to nothing was meant to name a
		// second deployment. Falling back to the default installs over the first.
		const box = sandbox();
		const run = box.run([...baseArgs, "--project", ""]);
		assert.notEqual(run.status, 0, run.output);
		assert.match(run.stderr, /--project got an empty name/);
		assert.ok(!existsSync(join(box.cwd, "reader")), run.output);
	});

	it("looks for a running stack under its own project, not the default one", () => {
		// The free-port check skips a port this deployment already holds, so it
		// has to ask about this deployment's containers. Asking about the default
		// project's would let a second install take a port off the first one.
		const run = sandbox().run(["--origin", ORIGIN, "--project", "beta"]);
		assert.equal(run.status, 0, run.output);
		assert.ok(
			run.argv.includes("com.docker.compose.project=beta"),
			`the running-stack check was scoped elsewhere:\n${run.argv}`,
		);
	});
});

describe("re-running the installer over a second deployment", () => {
	const box = sandbox();
	const dir = join(box.cwd, "beta");
	const first = box.run([...baseArgs, "--project", "beta", "--dir", dir]);

	it("installs the first time", () => {
		assert.equal(first.status, 0, first.output);
	});

	it("keeps the project the directory already holds", () => {
		const again = box.run([...baseArgs, "--dir", dir]);
		assert.equal(again.status, 0, again.output);
		assert.deepEqual(again.value("REMIT_PROJECT", dir), ["beta"]);
	});

	it("refuses a --project that would rename it", () => {
		const again = box.run([...baseArgs, "--project", "gamma", "--dir", dir]);
		assert.notEqual(again.status, 0);
		assert.match(again.stderr, /holds the deployment 'beta'/);
		assert.deepEqual(again.value("REMIT_PROJECT", dir), ["beta"]);
	});
});

// Every deployment installed before this flag existed. Its .env has no
// REMIT_PROJECT line and its stack runs under the compose file's default, so an
// absent line is that deployment's project and not an absent deployment.
const legacyDeployment = () => {
	const box = sandbox();
	const dir = join(box.cwd, "reader");
	const first = box.run([...baseArgs, "--dir", dir]);
	assert.equal(first.status, 0, first.output);
	const envPath = join(dir, ".env");
	const before = readFileSync(envPath, "utf8")
		.split("\n")
		.filter((line) => !line.startsWith("REMIT_PROJECT="))
		.join("\n");
	writeFileSync(envPath, before);
	return { box, dir, envPath, before };
};

describe("a deployment installed before there were project names", () => {
	it("keeps running under the project it has always had", () => {
		const { box, dir } = legacyDeployment();
		const again = box.run([...baseArgs, "--dir", dir]);
		assert.equal(again.status, 0, again.output);
		assert.deepEqual(again.value("REMIT_PROJECT", dir), ["remit"]);
	});

	it("is not renamed out from under its data by --project", () => {
		const { box, dir, envPath, before } = legacyDeployment();
		const again = box.run([...baseArgs, "--project", "beta", "--dir", dir]);
		assert.notEqual(
			again.status,
			0,
			`the live deployment was renamed to 'beta':\n${again.output}`,
		);
		assert.match(again.stderr, /holds the deployment 'remit'/);
		assert.equal(
			readFileSync(envPath, "utf8"),
			before,
			"the refusal must leave the deployment's .env exactly as it was",
		);
	});

	it("is not renamed through \\$REMIT_DIR either", () => {
		const { box, dir, envPath, before } = legacyDeployment();
		const again = box.run([...baseArgs, "--project", "beta"], {
			REMIT_DIR: dir,
		});
		assert.notEqual(again.status, 0, again.output);
		assert.equal(readFileSync(envPath, "utf8"), before);
	});
});

describe("the wrapper a deployment is managed with", () => {
	it("is remit for the default project", () => {
		const box = sandbox();
		const run = box.run(["--origin", ORIGIN, "--dir", join(box.cwd, "reader")]);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(box.onPath(), ["remit"]);
	});

	it("is remit-<name> for a named one, beside the default deployment's", () => {
		const box = sandbox();
		const first = box.run([
			"--origin",
			ORIGIN,
			"--dir",
			join(box.cwd, "reader"),
		]);
		assert.equal(first.status, 0, first.output);
		const second = box.run([
			"--origin",
			"https://beta.example.test",
			"--project",
			"beta",
		]);
		assert.equal(second.status, 0, second.output);
		assert.deepEqual(box.onPath(), ["remit", "remit-beta"]);
	});

	it("points at its own deployment directory", () => {
		const box = sandbox({ stubWrapper: false });
		const run = box.run([...baseArgs, "--project", "beta"]);
		assert.equal(run.status, 0, run.output);
		const wrapper = readFileSync(join(box.cwd, "reader-beta", "remit"), "utf8");
		assert.match(
			wrapper,
			new RegExp(`^DEFAULT_DIR=${join(box.cwd, "reader-beta")}$`, "m"),
		);
	});

	it("calls itself by the name the operator types", () => {
		// The wrapper names itself in its own errors and hints. Telling a second
		// deployment's operator to run `remit` sends them at the other stack.
		const box = sandbox({ stubWrapper: false });
		const run = box.run([...baseArgs, "--project", "beta"]);
		assert.equal(run.status, 0, run.output);
		assert.match(
			readFileSync(join(box.cwd, "reader-beta", "remit"), "utf8"),
			/^PROG=remit-beta$/m,
		);
	});

	it("is what the summary tells the operator to type", () => {
		const box = sandbox();
		const run = box.run(["--origin", ORIGIN, "--project", "beta"]);
		assert.match(run.stdout, /^ {2}Project {5}beta$/m);
		assert.match(run.stdout, /remit-beta status/);
	});

	it("stays unqualified on the default project", () => {
		const box = sandbox();
		const run = box.run(["--origin", ORIGIN, "--dir", join(box.cwd, "reader")]);
		assert.ok(!/Project/.test(run.stdout), run.stdout);
		assert.match(run.stdout, /^ {2}Manage {6}remit status/m);
	});
});

// reader#1082. `remit update` installs the release's own wrapper into the
// install directory, and nothing refreshes a copy taken at install time: a verb
// the release added answered `unknown command` from /usr/local/bin until the
// operator re-ran the installer. What goes on PATH points at the one file.
describe("the entry on PATH follows the deployment's own wrapper", () => {
	it("answers a verb an update added to it", () => {
		const box = sandbox();
		const dir = join(box.cwd, "reader");
		const run = box.run(["--origin", ORIGIN, "--dir", dir]);
		assert.equal(run.status, 0, run.output);

		// The deployment as an update leaves it: the release's wrapper, in place,
		// answering a verb the installed one never had.
		script(
			join(dir, "remit"),
			[
				"#!/bin/sh",
				'case "${1:-}" in',
				"semantic) printf 'semantic\\n' ;;",
				"*) exit 1 ;;",
				"esac",
				"",
			].join("\n"),
		);
		const typed = spawnSync(join(box.bindir, "remit"), ["semantic"], {
			encoding: "utf8",
		});
		assert.equal(typed.status, 0, typed.stderr);
		assert.equal(typed.stdout, "semantic\n");
	});
});

// What Compose itself makes of a deployment's .env, resolved the way the tunnel
// suite resolves it: a real `docker compose config` against the committed file.
// The project name is the one thing every container, volume and network is
// named from, so what it resolves to is the whole of this feature.

// A missing tool is a fact about a developer's machine and never about CI:
// skipping there would leave a suite that reports green having resolved nothing.
const require_ = (available, what) => {
	if (available) return true;
	if (process.env.CI) throw new Error(`${what} — this suite needs it`);
	console.log(`skipping: ${what}`);
	return false;
};

const COMPOSE_OK = require_(
	spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0,
	"no `docker compose` on this machine",
);

// Compose reads the process environment as well as --env-file, and an ambient
// REMIT_PROJECT would decide the answer on some machines and not others.
const CLEAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

function resolvedIn(dir) {
	const run = spawnSync(
		"docker",
		[
			"compose",
			"-f",
			join(dir, "docker-compose.sqlite.yml"),
			"--project-directory",
			dir,
			"--env-file",
			join(dir, ".env"),
			"config",
			"--format",
			"json",
		],
		{ encoding: "utf8", env: CLEAN_ENV },
	);
	assert.equal(
		run.status,
		0,
		`docker compose config failed: ${run.stderr || run.stdout}`,
	);
	return JSON.parse(run.stdout);
}

// An install directory holding the committed compose file and the given .env.
function deployment(lines) {
	const dir = mkdtempSync(join(TMP_ROOT, "install-project-config-"));
	sandboxes.push(dir);
	cpSync(
		join(DEPLOY, "docker-compose.sqlite.yml"),
		join(dir, "docker-compose.sqlite.yml"),
	);
	writeFileSync(join(dir, ".env"), `${lines.join("\n")}\n`);
	return dir;
}

// A deployment from before there were project names.
const LEGACY_ENV = [
	"REMIT_TAG=v1.0.0",
	"PUBLIC_ORIGIN=https://mail.example.test",
	"REMIT_DEPLOY_DIR=/opt/reader",
];

describe("what compose namespaces follows the project", {
	skip: !COMPOSE_OK,
}, () => {
	it("is the default project where no .env names one", () => {
		assert.equal(resolvedIn(deployment(LEGACY_ENV)).name, "remit");
	});

	it("is the project the .env names", () => {
		const config = resolvedIn(
			deployment([...LEGACY_ENV, "REMIT_PROJECT=beta"]),
		);
		assert.equal(config.name, "beta");
	});

	it("is what the installer wrote, without the installer being asked", () => {
		// The .env install.sh produces is the input compose resolves the project
		// from. Nothing translates between the two, and this is what says so.
		const box = sandbox();
		const dir = join(box.cwd, "reader-beta");
		const run = box.run([...baseArgs, "--project", "beta"]);
		assert.equal(run.status, 0, run.output);
		assert.equal(resolvedIn(dir).name, "beta");
	});

	it("carries the updater's state volume with it", () => {
		// The updater's snapshot and restore helpers are containers it starts
		// against the host daemon, so they name that volume themselves rather than
		// mounting it. A name that did not follow the project would have a second
		// deployment's update snapshot the first one's volume.
		const beta = resolvedIn(deployment([...LEGACY_ENV, "REMIT_PROJECT=beta"]));
		assert.equal(
			beta.services.updater.environment.REMIT_UPDATE_STATE_MOUNT,
			"beta_updater_state",
		);
	});

	it("resolves to the name baked into the updater image on a legacy .env", () => {
		// Two files hold this string: the compose default here and the image's own
		// ENV, which is what a bare `docker run` of the updater falls back to. They
		// name the same volume or the updater binds an empty one.
		const baked = readFileSync(join(ROOT, "Dockerfile"), "utf8").match(
			/^ENV REMIT_UPDATE_STATE_MOUNT=(\S+)$/m,
		)?.[1];
		assert.ok(
			baked,
			"the updater image no longer bakes REMIT_UPDATE_STATE_MOUNT",
		);
		assert.equal(
			resolvedIn(deployment(LEGACY_ENV)).services.updater.environment
				.REMIT_UPDATE_STATE_MOUNT,
			baked,
		);
	});

	it("is the one the e2e overlay pins, from the env file that lane installs", () => {
		const dir = mkdtempSync(join(TMP_ROOT, "install-project-e2e-"));
		sandboxes.push(dir);
		for (const file of [
			"docker-compose.sqlite.yml",
			"docker-compose.dovecot.yml",
			"docker-compose.e2e.yml",
		]) {
			cpSync(join(DEPLOY, file), join(dir, file));
		}
		// The lane's own two steps: e2e.env becomes .env, and the deployment
		// directory is appended to it (npm-scripts/e2e-compose.sh).
		writeFileSync(
			join(dir, ".env"),
			`${readFileSync(join(DEPLOY, "e2e.env"), "utf8")}\nREMIT_DEPLOY_DIR=${dir}\n`,
		);
		const run = spawnSync(
			"docker",
			[
				"compose",
				"-f",
				join(dir, "docker-compose.sqlite.yml"),
				"-f",
				join(dir, "docker-compose.dovecot.yml"),
				"-f",
				join(dir, "docker-compose.e2e.yml"),
				"--project-directory",
				dir,
				"--env-file",
				join(dir, ".env"),
				"config",
				"--format",
				"json",
			],
			{ encoding: "utf8", env: CLEAN_ENV },
		);
		assert.equal(run.status, 0, run.stderr || run.stdout);
		const config = JSON.parse(run.stdout);
		// The overlay names the project and e2e.env names it again, for the wrapper
		// that reads .env rather than the compose file. A disagreement is helper
		// containers reaching for volumes that stack does not have.
		assert.equal(
			config.services.updater.environment.REMIT_UPDATE_STATE_MOUNT,
			`${config.name}_updater_state`,
		);
	});
});
