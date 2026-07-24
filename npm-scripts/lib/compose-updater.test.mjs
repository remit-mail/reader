// The updater service and control seam in the reference compose (RFC 037 D4,
// #133). These are properties of the deployment surface — which service can see
// which volume — so they are asserted against the committed compose file rather
// than a running stack: the point is that no worker container mounts the seam.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const text = readFileSync(COMPOSE, "utf8");

// A compose-shaped scan: services at two-space indent, their `volumes:` block at
// four, entries at six. Enough for this file, and it deliberately reads the
// committed source rather than `docker compose config` so the suite needs no
// docker and no env.
function serviceVolumes(source) {
	const result = {};
	let inServices = false;
	let service = null;
	let inVolumes = false;
	for (const line of source.split("\n")) {
		if (/^services:\s*$/.test(line)) {
			inServices = true;
			continue;
		}
		if (!inServices) continue;
		if (/^\S/.test(line)) {
			inServices = false;
			service = null;
			inVolumes = false;
			continue;
		}
		const svc = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
		if (svc) {
			service = svc[1];
			result[service] = [];
			inVolumes = false;
			continue;
		}
		if (!service) continue;
		if (/^ {4}volumes:\s*$/.test(line)) {
			inVolumes = true;
			continue;
		}
		if (inVolumes) {
			const entry = line.match(/^ {6}- (.+?)\s*$/);
			if (entry) {
				result[service].push(entry[1]);
				continue;
			}
			if (/^ {2,4}\S/.test(line)) inVolumes = false;
		}
	}
	return result;
}

const source = (entry) => entry.split(":")[0];
const volumes = serviceVolumes(text);
const mounts = (svc) => (volumes[svc] ?? []).map(source);
const mountsOf = (name) =>
	Object.keys(volumes).filter((svc) => mounts(svc).includes(name));

describe("the updater compose surface", () => {
	it("mounts the control volume into backend and updater, and no other service", () => {
		assert.deepEqual(mountsOf("updater_control").sort(), [
			"backend",
			"updater",
		]);
	});

	it("keeps the updater's private state volume off every other service", () => {
		assert.deepEqual(mountsOf("updater_state"), ["updater"]);
	});

	it("does not expose the seam to any worker", () => {
		for (const worker of [
			"imap-worker",
			"smtp-worker",
			"account-worker",
			"search-index-worker",
			"queue",
			"web",
			"apisix",
			"caddy",
		]) {
			assert.ok(
				!mounts(worker).includes("updater_control"),
				`${worker} must not mount updater_control`,
			);
		}
	});

	it("gives the updater exactly its four documented mounts", () => {
		const u = mounts("updater").sort();
		assert.deepEqual(u, [
			".",
			"/var/run/docker.sock",
			"updater_control",
			"updater_state",
		]);
		// It reaches sqlite_data read-write through the socket, never as a direct
		// mount — that is the whole reason the socket is the real privilege here.
		assert.ok(!u.includes("sqlite_data"));
	});

	it("declares the two new volumes", () => {
		assert.match(text, /^ {2}updater_state:\s*$/m);
		assert.match(text, /^ {2}updater_control:\s*$/m);
	});
});

describe("the updater service definition", () => {
	const block =
		text.match(/^ {2}updater:\n([\s\S]*?)(?=^ {2}\S|^volumes:)/m)?.[1] ?? "";

	it("is present", () => {
		assert.ok(block.length > 0, "no updater service found");
	});

	it("pins its image to REMIT_TAG, like every other released image", () => {
		assert.match(
			block,
			/image:\s*ghcr\.io\/remit-mail\/reader\/updater:\$\{REMIT_TAG:-latest\}/,
		);
	});

	it("carries the load-bearing restart policy that drives boot recovery", () => {
		assert.match(block, /^ {4}restart:\s*unless-stopped\s*$/m);
	});

	it("opens no port", () => {
		assert.ok(!/^ {4}ports:/m.test(block));
	});
});
