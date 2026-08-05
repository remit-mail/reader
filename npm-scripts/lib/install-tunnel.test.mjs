// install.sh under --tls-mode tunnel (reader#567 D10, D13), driven as an
// operator drives it: a real bash run against a local asset base, a container
// engine stand-in, and a PATH that holds nothing but stand-ins.
//
// That PATH is what makes the credential assertions mean something. Every
// external command the installer runs is a wrapper that records its arguments
// and execs the real binary, and there is nothing else on PATH — a command the
// installer reaches for that has no wrapper is not found, so the run fails
// loudly instead of slipping past the recording. The credential appearing in
// that log is the credential appearing in `ps`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
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

const TOKEN = "eyJhIjoi-a-tunnel-credential-nobody-else-may-see";
const ORIGIN = "https://mail.example.test";

// Everything install.sh runs, plus what the shells it starts run. A name
// missing here is a name the run cannot resolve, which is the point.
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

// Resolved here, because the sandbox PATH the run gets does not contain it.
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

// A container engine that answers the questions install.sh asks it and records
// every one, so the credential assertions cover the compose calls too.
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

// `ss -ltnH`: state, queues, then the local address in the fourth column,
// which is the column install.sh reads.
const FAKE_SS = `#!/bin/sh
${RECORD}
for _a in $REMIT_FAKE_LISTEN; do
	printf 'LISTEN 0 4096 %s *:*\\n' "$_a"
done
exit 0
`;

// The wrapper install.sh fetches, reduced to the two things the installer asks
// of it: a verdict for the origin, and the update that starts the stack. The
// wrapper's own behaviour is covered where it lives.
const STUB_REMIT = `#!/bin/sh
case "\${1:-}" in
probe-host) printf '%s\\n' "\${REMIT_FAKE_PROBE:-elsewhere 203.0.113.10}" ;;
update) printf 'stub: images pulled, stack started\\n' ;;
esac
exit 0
`;

const TOKEN_DIR = mkdtempSync(join(TMP_ROOT, "install-tunnel-token-"));
sandboxes.push(TOKEN_DIR);
const TOKEN_FILE = join(TOKEN_DIR, "tunnel.token");
writeFileSync(TOKEN_FILE, `${TOKEN}\n`);
const EMPTY_TOKEN_FILE = join(TOKEN_DIR, "empty.token");
writeFileSync(EMPTY_TOKEN_FILE, "\n");

function sandbox() {
	const root = mkdtempSync(join(TMP_ROOT, "install-tunnel-"));
	sandboxes.push(root);
	const bin = join(root, "bin");
	const assets = join(root, "assets");
	const bindir = join(root, "usrbin");
	const dir = join(root, "reader");
	const argvLog = join(root, "argv.log");
	for (const d of [bin, bindir]) mkdirSync(d, { recursive: true });
	writeFileSync(argvLog, "");

	cpSync(DEPLOY, assets, { recursive: true });
	script(join(assets, "remit"), STUB_REMIT);

	script(join(bin, "docker"), FAKE_DOCKER);
	script(join(bin, "ss"), FAKE_SS);
	for (const name of PASSTHROUGH) {
		const real = realPath(name);
		if (!real) continue;
		script(join(bin, name), `#!/bin/sh\n${RECORD}\nexec ${real} "$@"\n`);
	}

	const envFile = () => readFileSync(join(dir, ".env"), "utf8");
	return {
		dir,
		run(args, { listen = "", probe = "", env = {} } = {}) {
			const result = spawnSync(BASH, [INSTALL, "--dir", dir, ...args], {
				encoding: "utf8",
				env: {
					PATH: bin,
					HOME: root,
					REMIT_ASSET_BASE: assets,
					REMIT_BINDIR: bindir,
					REMIT_ARGV_LOG: argvLog,
					REMIT_FAKE_LISTEN: listen,
					REMIT_FAKE_PROBE: probe,
					...env,
				},
			});
			return {
				...result,
				dir,
				output: `${result.stdout}${result.stderr}`,
				argv: readFileSync(argvLog, "utf8"),
				envFile,
				value: (key) =>
					envFile()
						.split("\n")
						.filter((line) => line.startsWith(`${key}=`))
						.map((line) => line.slice(key.length + 1)),
			};
		},
	};
}

const install = (args, opts) => sandbox().run(args, opts);

const tunnelArgs = (extra = []) => [
	"--tls-mode",
	"tunnel",
	"--origin",
	ORIGIN,
	...extra,
];

const fromFile = (extra = [], opts) =>
	install(tunnelArgs(["--tunnel-token-file", TOKEN_FILE, ...extra]), opts);

describe("--tls-mode tunnel needs a credential it can never leak", () => {
	it("refuses to install without one", () => {
		const run = install(tunnelArgs(["--dry-run"]));
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /--tunnel-token-file/);
		assert.match(run.stderr, /REMIT_TUNNEL_TOKEN/);
	});

	it("has no flag that takes the credential itself", () => {
		const run = install(tunnelArgs(["--tunnel-token", TOKEN, "--dry-run"]));
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /no --tunnel-token flag/);
		assert.match(run.stderr, /history/);
	});

	it("reads it from a file", () => {
		const run = fromFile(["--dry-run"]);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("TUNNEL_TOKEN"), [TOKEN]);
	});

	it("reads it from the environment", () => {
		const run = install(tunnelArgs(["--dry-run"]), {
			env: { REMIT_TUNNEL_TOKEN: TOKEN },
		});
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("TUNNEL_TOKEN"), [TOKEN]);
	});

	it("refuses a file with nothing in it", () => {
		const run = install(
			tunnelArgs(["--tunnel-token-file", EMPTY_TOKEN_FILE, "--dry-run"]),
		);
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /holds nothing/);
	});

	it("refuses a file that is not there", () => {
		const run = install(
			tunnelArgs(["--tunnel-token-file", "/nonexistent.token", "--dry-run"]),
		);
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /no such file/);
	});

	it("never puts it on a command line", () => {
		const run = fromFile(["--dry-run"]);
		assert.equal(run.status, 0, run.output);
		// An empty recording would pass the assertion below without having
		// watched anything.
		assert.match(run.argv, /\/docker compose/);
		assert.match(run.argv, /\/awk/);
		assert.ok(
			!run.argv.includes(TOKEN),
			`the credential reached a command line:\n${run.argv
				.split("\n")
				.filter((line) => line.includes(TOKEN))
				.join("\n")}`,
		);
	});

	it("never prints it", () => {
		const run = fromFile(["--dry-run"]);
		assert.ok(!run.output.includes(TOKEN), run.output);
	});

	it("puts it in a .env only its owner can read", () => {
		const run = fromFile(["--dry-run"]);
		assert.equal(statSync(join(run.dir, ".env")).mode & 0o777, 0o600);
	});

	it("applies to --tls-mode tunnel only", () => {
		const run = install([
			"--tls-mode",
			"acme",
			"--origin",
			ORIGIN,
			"--tunnel-token-file",
			TOKEN_FILE,
			"--dry-run",
		]);
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /applies to --tls-mode tunnel/);
	});
});

describe("--tls-mode tunnel's public identity", () => {
	const httpOrigin = () =>
		install([
			"--tls-mode",
			"tunnel",
			"--origin",
			"http://mail.example.test",
			"--tunnel-token-file",
			TOKEN_FILE,
			"--dry-run",
		]);

	it("must be https, because TLS terminates at the edge", () => {
		const run = httpOrigin();
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /must be https/);
	});

	it("is never guessed at from an http one", () => {
		const run = httpOrigin();
		assert.ok(!existsSync(join(run.dir, ".env")));
	});

	it("is written as given", () => {
		assert.deepEqual(fromFile(["--dry-run"]).value("PUBLIC_ORIGIN"), [ORIGIN]);
	});
});

describe("what a tunnel install writes to .env", () => {
	const run = fromFile(["--dry-run"]);

	it("installs at all", () => {
		assert.equal(run.status, 0, run.output);
	});

	it("selects the mode", () => {
		assert.deepEqual(run.value("TLS_MODE"), ["tunnel"]);
	});

	it("leaves the profile derived from the mode", () => {
		const template = readFileSync(join(DEPLOY, "remit.env.template"), "utf8")
			.split("\n")
			.filter((line) => line.startsWith("COMPOSE_PROFILES="))
			.map((line) => line.slice("COMPOSE_PROFILES=".length));
		assert.deepEqual(
			run.value("COMPOSE_PROFILES"),
			template,
			"a second COMPOSE_PROFILES is a value that can disagree with TLS_MODE",
		);
	});

	it("publishes caddy's http port on loopback and nowhere else", () => {
		assert.deepEqual(run.value("CADDY_HTTP_BIND"), ["127.0.0.1:8080"]);
	});

	it("leaves the https publish at its default, which has no listener here", () => {
		assert.deepEqual(run.value("CADDY_HTTPS_BIND"), ["0.0.0.0:443"]);
	});

	it("takes another loopback address when told to", () => {
		const other = fromFile(["--http-bind", "127.0.0.1:8081", "--dry-run"]);
		assert.equal(other.status, 0, other.output);
		assert.deepEqual(other.value("CADDY_HTTP_BIND"), ["127.0.0.1:8081"]);
	});

	it("refuses to publish that port anywhere a browser could reach it", () => {
		const other = fromFile(["--http-bind", "0.0.0.0:8080", "--dry-run"]);
		assert.notEqual(other.status, 0);
		assert.match(other.stderr, /loopback address/);
	});

	it("states the sign-up setting, so closing it is a real edit", () => {
		assert.deepEqual(run.value("SELF_SIGN_UP_ENABLED"), ["true"]);
	});

	it("closes sign-up with the sed the summary prints", () => {
		const box = fromFile(["--dry-run"]);
		const sed = spawnSync(
			"sed",
			[
				"-i",
				"s/^SELF_SIGN_UP_ENABLED=.*/SELF_SIGN_UP_ENABLED=false/",
				join(box.dir, ".env"),
			],
			{ encoding: "utf8" },
		);
		assert.equal(sed.status, 0, sed.stderr);
		assert.deepEqual(box.value("SELF_SIGN_UP_ENABLED"), ["false"]);
	});

	it("installs the site file the mode mounts", () => {
		assert.ok(existsSync(join(run.dir, "caddy", "tunnel.caddy")));
	});

	it("changes nothing for a mode that is not this one", () => {
		const other = install([
			"--tls-mode",
			"internal",
			"--origin",
			ORIGIN,
			"--dry-run",
		]);
		assert.equal(other.status, 0, other.output);
		assert.deepEqual(other.value("TLS_MODE"), ["internal"]);
		assert.deepEqual(other.value("CADDY_HTTP_BIND"), []);
		assert.deepEqual(other.value("TUNNEL_TOKEN"), []);
	});
});

describe("re-running a tunnel install", () => {
	const box = sandbox();
	const first = box.run(tunnelArgs(["--tunnel-token-file", TOKEN_FILE]));

	it("installs the first time", () => {
		assert.equal(first.status, 0, first.output);
	});

	it("keeps a credential it already has, with none supplied", () => {
		const envPath = join(box.dir, ".env");
		writeFileSync(
			envPath,
			readFileSync(envPath, "utf8").replace(
				/^SELF_SIGN_UP_ENABLED=.*$/m,
				"SELF_SIGN_UP_ENABLED=false",
			),
		);
		const again = box.run(tunnelArgs());
		assert.equal(again.status, 0, again.output);
		assert.deepEqual(again.value("TUNNEL_TOKEN"), [TOKEN]);
	});

	it("does not reopen a sign-up the operator closed", () => {
		assert.match(
			readFileSync(join(box.dir, ".env"), "utf8"),
			/^SELF_SIGN_UP_ENABLED=false$/m,
		);
	});
});

describe("the free-port check follows the mode", () => {
	it("lets a tunnel install past 80 and 443 in use", () => {
		const busy = fromFile([], { listen: "0.0.0.0:80 0.0.0.0:443" });
		assert.equal(busy.status, 0, busy.output);
	});

	it("stops on the loopback port it is about to publish", () => {
		const busy = fromFile([], { listen: "127.0.0.1:8080" });
		assert.notEqual(busy.status, 0);
		assert.match(busy.stderr, /port 8080 is already in use/);
	});

	it("follows --http-bind to another port", () => {
		const busy = fromFile(["--http-bind", "127.0.0.1:8081"], {
			listen: "127.0.0.1:8081",
		});
		assert.notEqual(busy.status, 0);
		assert.match(busy.stderr, /port 8081 is already in use/);
	});

	it("still stops a mode that publishes 80 and 443", () => {
		const busy = install(["--tls-mode", "acme", "--origin", ORIGIN], {
			listen: "0.0.0.0:80",
		});
		assert.notEqual(busy.status, 0);
		assert.match(busy.stderr, /port 80 is already in use/);
	});
});

describe("a hostname that answers somewhere else", () => {
	it("is the topology a tunnel install expects, not a warning", () => {
		const run = fromFile([], { probe: "elsewhere 203.0.113.10" });
		assert.equal(run.status, 0, run.output);
		assert.ok(
			!run.output.includes("203.0.113.10"),
			`the edge's address was reported as a problem:\n${run.output}`,
		);
		assert.ok(!/does not hold/.test(run.output), run.output);
	});

	it("is still a warning in a mode that serves the hostname itself", () => {
		const run = install(["--tls-mode", "acme", "--origin", ORIGIN], {
			probe: "elsewhere 203.0.113.10",
		});
		assert.equal(run.status, 0, run.output);
		assert.match(run.output, /203\.0\.113\.10/);
	});
});

describe("the installer summary", () => {
	const run = fromFile([], { probe: "elsewhere 203.0.113.10" });

	it("reports a finished install", () => {
		assert.equal(run.status, 0, run.output);
		assert.match(run.stdout, /reader is up\./);
	});

	it("closes with the step that shuts the sign-up window", () => {
		const at = run.stdout.indexOf("DO THIS NOW");
		assert.ok(at >= 0, `no sign-up step in the summary:\n${run.stdout}`);
		const tail = run.stdout.slice(at);
		assert.match(tail, /sign up/i);
		assert.match(tail, /SELF_SIGN_UP_ENABLED=false/);
		assert.match(tail, /remit restart/);
		assert.ok(
			at > run.stdout.indexOf("  Config"),
			"the step has to be the last thing read, not one line among the facts",
		);
	});

	it("says where the app is while the tunnel is down", () => {
		assert.match(run.stdout, /127\.0\.0\.1:8080/);
	});

	it("says none of this on a mode that is not public", () => {
		const other = install(["--tls-mode", "internal", "--origin", ORIGIN]);
		assert.equal(other.status, 0, other.output);
		assert.ok(!other.stdout.includes("DO THIS NOW"), other.stdout);
	});
});
