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
		run(args) {
			const result = spawnSync(BASH, [INSTALL, ...args], {
				cwd,
				encoding: "utf8",
				env: {
					PATH: bin,
					HOME: root,
					REMIT_ASSET_BASE: assets,
					REMIT_BINDIR: bindir,
					REMIT_ARGV_LOG: argvLog,
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

describe("what compose namespaces follows the project", () => {
	const compose = readFileSync(
		join(DEPLOY, "docker-compose.sqlite.yml"),
		"utf8",
	);

	it("names the project from .env, defaulting to the first deployment's", () => {
		assert.match(compose, /^name: \$\{REMIT_PROJECT:-remit\}$/m);
	});

	it("keeps the updater's helper containers on their own project's volume", () => {
		// The updater's snapshot and restore helpers bind this volume by the name
		// the host daemon knows, which carries the project — and the name baked
		// into the image cannot.
		assert.match(
			compose,
			/REMIT_UPDATE_STATE_MOUNT: \$\{REMIT_PROJECT:-remit\}_updater_state/,
		);
	});

	it("agrees with the project the e2e overlay pins", () => {
		const overlay = readFileSync(
			join(DEPLOY, "docker-compose.e2e.yml"),
			"utf8",
		);
		const named = overlay.match(/^name: (\S+)$/m)?.[1];
		const env = readFileSync(join(DEPLOY, "e2e.env"), "utf8").match(
			/^REMIT_PROJECT=(\S+)$/m,
		)?.[1];
		assert.equal(
			env,
			named,
			"the e2e stack's wrapper reads REMIT_PROJECT for volume names compose derived from `name:`",
		);
	});
});
