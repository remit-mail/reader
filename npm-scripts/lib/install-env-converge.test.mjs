// Re-running install.sh over an .env older than the template it ships with.
//
// Driven the way the tunnel and project suites drive it — a real bash run
// against a local asset base, a container-engine stand-in, and a PATH holding
// nothing else — because what is asserted is the file an operator's deployment
// is left with after the re-run, not what the script meant to write.
//
// The scenario is the one that took a live deployment off the internet: an .env
// written before the tunnel work, re-run with --tls-mode tunnel. Without
// COMPOSE_PROFILES the tunnel agent's compose profile never matches, so the
// agent never starts and the install reports success anyway.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
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
const INSTALL = join(ROOT, "install.sh");
const DEPLOY = join(ROOT, "deploy", "vps");
const TEMPLATE = readFileSync(join(DEPLOY, "remit.env.template"), "utf8");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const ORIGIN = "https://mail.example.test";
const TOKEN = "eyJhIjoi-a-tunnel-credential-nobody-else-may-see";

// What the install of 2026-07-25 generated. Byte-identical is the assertion
// these exist for, so they are values, not patterns.
const OLD_AUTH_SECRET =
	"3d0f1a7c8b2e45960d7f4c1ab8e3925f607c4de1938ba25fc0e7d1462a8b93f5";
const OLD_DATAKEY =
	"a71c34e0b95d28f6417ce0a3d582b9174fe6c0d83b1a4927e5c08f3d6b2a1e94";

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

const FAKE_SS = `#!/bin/sh
${RECORD}
exit 0
`;

const STUB_REMIT = `#!/bin/sh
case "\${1:-}" in
probe-host) printf 'elsewhere 203.0.113.10\\n' ;;
update) printf 'stub: images pulled, stack started\\n' ;;
esac
exit 0
`;

const TOKEN_DIR = mkdtempSync(join(TMP_ROOT, "install-converge-token-"));
sandboxes.push(TOKEN_DIR);
const TOKEN_FILE = join(TOKEN_DIR, "tunnel.token");
writeFileSync(TOKEN_FILE, `${TOKEN}\n`);

function sandbox() {
	const root = mkdtempSync(join(TMP_ROOT, "install-converge-"));
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
		seed(contents) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, ".env"), contents, { mode: 0o600 });
		},
		run(args) {
			const result = spawnSync(BASH, [INSTALL, "--dir", dir, ...args], {
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
				dir,
				output: `${result.stdout}${result.stderr}`,
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

const templateValue = (key) =>
	TEMPLATE.split("\n")
		.filter((line) => line.startsWith(`${key}=`))
		.map((line) => line.slice(key.length + 1));

// The .env a pre-tunnel install left behind: the template with every mention of
// the named keys taken out, and that install's generated secrets in place of the
// placeholders. Deriving it from the shipped template rather than pasting a
// snapshot is what keeps the fixture from drifting into a file no installer ever
// wrote.
const envWithout = (...absent) => {
	const gone = (line) =>
		absent.some((key) => new RegExp(`^[ \\t]*#*[ \\t]*${key}=`).test(line));
	return `${TEMPLATE.split("\n")
		.filter((line) => !gone(line))
		.join("\n")
		.replace(
			/^BETTER_AUTH_SECRET=.*$/m,
			`BETTER_AUTH_SECRET=${OLD_AUTH_SECRET}`,
		)
		.replace(/^FAKE_KMS_DATAKEY=.*$/m, `FAKE_KMS_DATAKEY=${OLD_DATAKEY}`)
		.replace(/^PUBLIC_ORIGIN=.*$/m, "PUBLIC_ORIGIN=http://100.64.12.3")
		.replace(/^TLS_MODE=.*$/m, "TLS_MODE=off")}`;
};

// The keys this run is told to write. Everything else the file already held has
// to survive it byte for byte.
const REWRITTEN = new Set([
	"PUBLIC_ORIGIN",
	"TLS_MODE",
	"REMIT_PROJECT",
	"REMIT_TAG",
	"REMIT_DEPLOY_DIR",
	"CADDY_HTTP_BIND",
	"CADDY_HTTPS_BIND",
	"TUNNEL_TOKEN",
	"SELF_SIGN_UP_ENABLED",
]);

const settings = (contents) =>
	contents
		.split("\n")
		.filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
		.map((line) => [line.slice(0, line.indexOf("=")), line]);

const tunnelRun = (box) =>
	box.run([
		"--tls-mode",
		"tunnel",
		"--origin",
		ORIGIN,
		"--tunnel-token-file",
		TOKEN_FILE,
		"--dry-run",
	]);

describe("a tunnel re-run over an .env written before the tunnel existed", () => {
	const before = envWithout(
		"COMPOSE_PROFILES",
		"TUNNEL_TOKEN",
		"CADDY_HTTP_BIND",
		"CADDY_HTTPS_BIND",
	);
	const box = sandbox();
	box.seed(before);
	const run = tunnelRun(box);

	it("installs", () => {
		assert.equal(run.status, 0, run.output);
	});

	it("gains the profile line the tunnel agent is selected by", () => {
		assert.deepEqual(
			run.value("COMPOSE_PROFILES"),
			templateValue("COMPOSE_PROFILES"),
		);
	});

	it("gains it once, so no second value can disagree with TLS_MODE", () => {
		assert.equal(run.value("COMPOSE_PROFILES").length, 1);
	});

	it("defines it after the mode it is derived from", () => {
		const lines = run.envFile().split("\n");
		const at = (key) => lines.findIndex((line) => line.startsWith(`${key}=`));
		assert.ok(
			at("TLS_MODE") < at("COMPOSE_PROFILES"),
			"compose interpolates a .env top to bottom",
		);
	});

	it("keeps the identity signing key", () => {
		assert.deepEqual(run.value("BETTER_AUTH_SECRET"), [OLD_AUTH_SECRET]);
	});

	it("keeps the key every stored IMAP credential is encrypted under", () => {
		assert.deepEqual(run.value("FAKE_KMS_DATAKEY"), [OLD_DATAKEY]);
	});

	it("keeps every other value it already held, byte for byte", () => {
		const after = new Map(settings(run.envFile()));
		for (const [key, line] of settings(before)) {
			if (REWRITTEN.has(key)) continue;
			assert.equal(after.get(key), line, `${key} was rewritten`);
		}
	});

	it("says which keys it added", () => {
		assert.match(run.stdout, /COMPOSE_PROFILES: added from the template/);
	});
});

describe("what converging never does", () => {
	it("leaves a key the operator commented out commented out", () => {
		const box = sandbox();
		box.seed(
			envWithout("COMPOSE_PROFILES").replace(
				/^SEARCH_EMBEDDING_PROVIDER=.*$/m,
				"# SEARCH_EMBEDDING_PROVIDER=local",
			),
		);
		const run = tunnelRun(box);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("SEARCH_EMBEDDING_PROVIDER"), []);
	});

	it("leaves a key the operator emptied empty", () => {
		const box = sandbox();
		box.seed(
			envWithout("COMPOSE_PROFILES").replace(
				/^REMIT_UPDATE_MANIFEST_URL=.*$/m,
				"REMIT_UPDATE_MANIFEST_URL=",
			),
		);
		const run = tunnelRun(box);
		assert.equal(run.status, 0, run.output);
		assert.deepEqual(run.value("REMIT_UPDATE_MANIFEST_URL"), [""]);
	});

	it("never writes a placeholder as if it were a default", () => {
		const box = sandbox();
		box.seed(
			envWithout("COMPOSE_PROFILES", "BETTER_AUTH_SECRET", "PUBLIC_ORIGIN"),
		);
		const run = tunnelRun(box);
		assert.equal(run.status, 0, run.output);
		assert.ok(
			!run
				.envFile()
				.split("\n")
				.some((line) => /^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME/.test(line)),
			run.envFile(),
		);
		assert.deepEqual(run.value("PUBLIC_ORIGIN"), [ORIGIN]);
		assert.match(run.value("BETTER_AUTH_SECRET")[0], /^[0-9a-f]{64}$/);
	});

	it("adds nothing to an .env it wrote itself", () => {
		const box = sandbox();
		const run = tunnelRun(box);
		assert.equal(run.status, 0, run.output);
		assert.ok(!run.envFile().includes("Added by install.sh"), run.envFile());
	});

	it("adds nothing on a second re-run", () => {
		const box = sandbox();
		box.seed(envWithout("COMPOSE_PROFILES"));
		assert.equal(tunnelRun(box).status, 0);
		const once = box.run([
			"--tls-mode",
			"tunnel",
			"--origin",
			ORIGIN,
			"--dry-run",
		]);
		const settled = once.envFile();
		const again = box.run([
			"--tls-mode",
			"tunnel",
			"--origin",
			ORIGIN,
			"--dry-run",
		]);
		assert.equal(again.status, 0, again.output);
		assert.equal(again.envFile(), settled);
	});
});
