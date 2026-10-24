// `remit mcp enable <origin>` and `remit mcp disable` (remit-mail/remit#1342):
// the two .env values and the compose profile that turn the connector on, driven
// against the docker stand-in the other wrapper suites use.
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
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const FAKES = join(HERE, "remit-test");

// Taken from the template verbatim, so the line under edit is the one an
// operator's .env actually holds.
const TEMPLATE_PROFILES = readFileSync(
	join(ROOT, "deploy", "vps", "remit.env.template"),
	"utf8",
)
	.split("\n")
	.find((line) => line.startsWith("COMPOSE_PROFILES="));

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const SERVICES =
	"queue backend caddy web apisix imap-worker smtp-worker account-worker updater";

function sandbox(envLines) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-mcp-"));
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
			`services=${SERVICES} mcp`,
			`all_services=${SERVICES} migrate volume-init`,
			"profile_services=mcp",
			"",
		].join("\n"),
	);
	let seq = 0;
	for (const svc of `${SERVICES} mcp migrate`.split(" ")) {
		seq += 1;
		writeFileSync(join(fake, `cid-${svc}`), `c${svc}${seq}`);
		writeFileSync(join(fake, `svc-c${svc}${seq}`), svc);
		if (svc !== "migrate") writeFileSync(join(fake, `up-${svc}`), "");
	}
	writeFileSync(join(fake, "seq"), String(seq));
	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);

	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: dir,
		FAKE_DOCKER_DIR: fake,
		REMIT_DIR: deployment,
	};
	const dotenv = () => readFileSync(join(deployment, ".env"), "utf8");
	return {
		run: (args) => spawnSync("sh", [REMIT, ...args], { env, encoding: "utf8" }),
		dotenv,
		value: (key) =>
			dotenv()
				.split("\n")
				.find((line) => line.startsWith(`${key}=`))
				?.slice(key.length + 1),
		log: () => readFileSync(join(fake, "log"), "utf8"),
	};
}

const DEPLOYMENT = [
	"REMIT_TAG=v1.0.0",
	"PUBLIC_ORIGIN=https://mail.example.test",
	"TLS_MODE=acme",
	TEMPLATE_PROFILES,
];

describe("remit mcp enable", () => {
	const box = sandbox(DEPLOYMENT);
	const result = box.run(["mcp", "enable", "https://mcp.example.test/"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("sets the origin the connector answers on, without the trailing slash", () => {
		assert.equal(box.value("MCP_PUBLIC_ORIGIN"), "https://mcp.example.test");
	});

	it("generates a secret of its own", () => {
		assert.match(box.value("MCP_AUTH_SECRET") ?? "", /^[0-9a-f]{64}$/);
	});

	it("adds the profile to the template's line and keeps what was there", () => {
		assert.equal(box.value("COMPOSE_PROFILES"), "${TLS_MODE:-},mcp");
	});

	it("applies the change", () => {
		assert.match(box.log(), /compose up -d --remove-orphans/);
	});

	it("tells the operator the connector URL", () => {
		assert.match(result.stdout, /https:\/\/mcp\.example\.test\/mcp/);
	});

	it("keeps the secret and the profile list stable on a second run", () => {
		const secret = box.value("MCP_AUTH_SECRET");
		assert.equal(
			box.run(["mcp", "enable", "https://mcp.example.test"]).status,
			0,
		);
		assert.equal(box.value("MCP_AUTH_SECRET"), secret);
		assert.equal(box.value("COMPOSE_PROFILES"), "${TLS_MODE:-},mcp");
	});
});

describe("remit mcp enable refuses", () => {
	for (const [what, origin] of [
		["a path", "https://mcp.example.test/mcp"],
		["no scheme", "mcp.example.test"],
		["the instance's own origin", "https://mail.example.test"],
		["plain http on an https deployment", "http://mcp.example.test"],
	]) {
		it(`an origin with ${what}, changing nothing`, () => {
			const box = sandbox(DEPLOYMENT);
			const before = box.dotenv();
			const result = box.run(["mcp", "enable", origin]);
			assert.notEqual(result.status, 0);
			assert.equal(box.dotenv(), before);
		});
	}
});

describe("remit mcp disable", () => {
	const box = sandbox(DEPLOYMENT);
	box.run(["mcp", "enable", "https://mcp.example.test"]);
	const secret = box.value("MCP_AUTH_SECRET");
	const result = box.run(["mcp", "disable"]);

	it("succeeds", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("takes the profile out and leaves the template's value", () => {
		assert.equal(box.value("COMPOSE_PROFILES"), "${TLS_MODE:-}");
	});

	it("clears the origin, so Caddy routes nothing there", () => {
		assert.equal(box.value("MCP_PUBLIC_ORIGIN"), "");
	});

	it("removes the container rather than leaving a stopped one", () => {
		assert.match(box.log(), /compose --profile=\* rm --force --stop mcp/);
	});

	it("keeps the secret, so existing connections survive a re-enable", () => {
		assert.equal(box.value("MCP_AUTH_SECRET"), secret);
	});
});
