// The v0.9.22 and v0.9.23 wrappers never hand an update to the release's
// wrapper; they check the release's files themselves, and an install stuck on
// either can only move if this release passes that check. Reproduced verbatim
// from v0.9.22's stage_host_files: the compose file through `docker compose
// config`, the Caddy image as the first line of `config --images caddy`, and
// every mode file adapted in that image with only routes.caddy in /etc/caddy
// and only PUBLIC_ORIGIN set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEPLOY = join(ROOT, "deploy", "vps");
const CADDY_DIR = join(DEPLOY, "caddy");
const COMPOSE = join(DEPLOY, "docker-compose.sqlite.yml");
const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const dockerUp =
	spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
if (!dockerUp && process.env.CI) {
	throw new Error("no docker found — this suite needs it");
}
if (!dockerUp) console.log("skipping: no docker found");

const MODES = readdirSync(CADDY_DIR).filter(
	(name) => name.endsWith(".caddy") && name !== "routes.caddy",
);

const run = (args) => spawnSync("docker", args, { encoding: "utf8" });

if (dockerUp) {
	describe("the release's files, checked the way a v0.9.22 wrapper checks them", () => {
		const deployment = mkdtempSync(join(TMP_ROOT, "caddy-v0922-"));
		const envFile = join(deployment, ".env");
		writeFileSync(
			envFile,
			[
				"REMIT_TAG=v0.9.22",
				"PUBLIC_ORIGIN=https://mail.example.test",
				`REMIT_DEPLOY_DIR=${deployment}`,
				"TLS_MODE=tunnel",
				"",
			].join("\n"),
		);
		const compose = (...args) =>
			run([
				"compose",
				"--project-directory",
				deployment,
				"-f",
				COMPOSE,
				"--env-file",
				envFile,
				"config",
				...args,
			]);

		after(() => rmSync(deployment, { recursive: true, force: true }));

		it("renders the compose file", () => {
			const rendered = compose();
			assert.equal(rendered.status, 0, rendered.stderr);
		});

		const image = () => {
			const listed = compose("--images", "caddy");
			assert.equal(listed.status, 0, listed.stderr);
			return listed.stdout.split("\n")[0];
		};

		it("names the Caddy image first in `config --images caddy`", () => {
			assert.match(image(), /^caddy:/);
		});

		for (const mode of MODES) {
			it(`adapts ${mode} with routes.caddy alone in /etc/caddy`, () => {
				const checked = run([
					"run",
					"--rm",
					"-v",
					`${CADDY_DIR}:/state/host-files/run/incoming/caddy:ro`,
					"-e",
					"PUBLIC_ORIGIN=https://mail.example.test",
					"--entrypoint",
					"sh",
					image(),
					"-c",
					`set -eu
src=/state/host-files/run/incoming/caddy
cp "$src/routes.caddy" /etc/caddy/routes.caddy
for mode in ${mode}; do
  caddy adapt --adapter caddyfile --config "$src/$mode" >/dev/null
done`,
				]);
				assert.equal(checked.status, 0, checked.stderr);
			});
		}
	});
}
