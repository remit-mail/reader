// `remit sign-in on|off` (#1519): the
// kill switch lands as one line in .env, the restart only follows a read-back
// that matches, and the running backend has to answer as the switch says.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
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
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const FAKES = join(HERE, "remit-test");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const SERVICES =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker updater";

const REFUSED =
	'403 {"code":"SIGN_IN_DISABLED","message":"Sign-in is turned off on this server."}';

function sandbox(envLines, { probe = REFUSED, stubs = {} } = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-sign-in-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	for (const d of [deployment, fake, bin]) mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(join(deployment, ".env"), `${envLines.join("\n")}\n`);
	writeFileSync(
		join(fake, "scenario"),
		[
			`services=${SERVICES}`,
			`all_services=${SERVICES} migrate volume-init`,
			"",
		].join("\n"),
	);
	let seq = 0;
	for (const svc of `${SERVICES} migrate`.split(" ")) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		if (svc !== "migrate") writeFileSync(join(fake, `up-${svc}`), "");
	}
	writeFileSync(join(fake, "seq"), String(seq));
	writeFileSync(join(fake, "exec-out"), `${probe}\n`);
	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);
	for (const [name, script] of Object.entries(stubs)) {
		writeFileSync(join(bin, name), script, { mode: 0o755 });
	}

	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
		REMIT_SIGN_IN_PROBE_ATTEMPTS: "1",
		REMIT_UPDATE_PROBE_INTERVAL: "0",
	};
	const dotenv = () => readFileSync(join(deployment, ".env"), "utf8");
	return {
		run: (args) => spawnSync("sh", [REMIT, ...args], { env, encoding: "utf8" }),
		lines: (key) =>
			dotenv()
				.split("\n")
				.filter((line) => line.startsWith(`${key}=`)),
		log: () =>
			existsSync(join(fake, "log"))
				? readFileSync(join(fake, "log"), "utf8")
				: "",
	};
}

const DEPLOYMENT = [
	"REMIT_TAG=v1.0.0",
	"PUBLIC_ORIGIN=https://mail.example.test",
	"TLS_MODE=acme",
];

describe("remit sign-in off", () => {
	const box = sandbox([
		...DEPLOYMENT,
		"SIGN_IN_ENABLED=true",
		"OTHER=kept",
		"SIGN_IN_ENABLED=true",
	]);
	const result = box.run(["sign-in", "off"]);

	it("leaves exactly one line, holding false, where there were two", () => {
		assert.deepEqual(box.lines("SIGN_IN_ENABLED"), ["SIGN_IN_ENABLED=false"]);
		assert.deepEqual(box.lines("OTHER"), ["OTHER=kept"]);
	});

	it("applies the change, then asks the running backend", () => {
		const log = box.log();
		const applied = log.indexOf("compose up -d --remove-orphans");
		const probed = log.indexOf("compose exec -T backend node -e");
		assert.ok(applied >= 0, log);
		assert.ok(probed > applied, log);
	});
});

describe("remit sign-in refuses", () => {
	it("to restart when the read-back differs, and names the variable", () => {
		const box = sandbox([...DEPLOYMENT, "SIGN_IN_ENABLED=true"], {
			stubs: { mv: "#!/bin/sh\nexit 0\n" },
		});
		const result = box.run(["sign-in", "off"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /SIGN_IN_ENABLED/);
		assert.match(result.stderr, /Nothing was restarted/);
		assert.doesNotMatch(box.log(), /compose up/);
	});

	it("to report success when the backend still serves sign-in, and gives its answer", () => {
		const box = sandbox([...DEPLOYMENT], { probe: "200 null" });
		const result = box.run(["sign-in", "off"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /answered '200 null'/);
		assert.match(result.stderr, /logs backend/);
	});
});
