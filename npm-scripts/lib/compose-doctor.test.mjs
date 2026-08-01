// The checker's deployment surface (standalone-observability D9 to D11).
//
// These are properties of what the container can reach, not of what its code
// does, so they are asserted against the committed compose file: no docker
// socket, no published port, no `.env`, and a heartbeat mount it cannot write.
// A future edit that adds any of them is a change to the design, and this is
// where it gets caught.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const text = readFileSync(COMPOSE, "utf8");

// A compose-shaped scan: services at two-space indent, their blocks at four,
// entries at six. Deliberately reads the committed source rather than
// `docker compose config`, so the suite needs no docker and no env.
function serviceBlocks(source) {
	const result = {};
	let inServices = false;
	let service = null;
	for (const line of source.split("\n")) {
		if (/^services:\s*$/.test(line)) {
			inServices = true;
			continue;
		}
		if (!inServices) continue;
		if (/^\S/.test(line)) {
			inServices = false;
			service = null;
			continue;
		}
		const svc = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
		if (svc) {
			service = svc[1];
			result[service] = [];
			continue;
		}
		if (service) result[service].push(line);
	}
	return result;
}

const blocks = serviceBlocks(text);
const doctor = blocks.doctor ?? [];
const body = doctor.join("\n");

function keyed(lines, key) {
	const out = [];
	let inside = false;
	for (const line of lines) {
		if (new RegExp(`^ {4}${key}:\\s*$`).test(line)) {
			inside = true;
			continue;
		}
		if (inside) {
			const entry = line.match(/^ {6}- (.+?)\s*$/);
			if (entry) {
				out.push(entry[1]);
				continue;
			}
			const pair = line.match(/^ {6}[A-Za-z0-9_-]+:.*$/);
			if (pair) {
				out.push(line.trim());
				continue;
			}
			if (/^ {2,4}\S/.test(line)) inside = false;
		}
	}
	return out;
}

describe("the checker's compose surface", () => {
	it("exists, and is not behind a profile", () => {
		assert.ok(blocks.doctor, "the compose file must declare a doctor service");
		assert.ok(
			!/^ {4}profiles:/m.test(body),
			"alerting ships with the stack; an operator who installed nothing is the one who needs it",
		);
	});

	it("mounts exactly the heartbeat volume and its own state, and nothing else", () => {
		assert.deepEqual(keyed(doctor, "volumes").sort(), [
			"doctor_state:/data/doctor",
			"heartbeat:/data/heartbeat:ro",
		]);
	});

	it("mounts the heartbeat volume read-only", () => {
		const heartbeat = keyed(doctor, "volumes").find((entry) =>
			entry.startsWith("heartbeat:"),
		);
		assert.match(heartbeat, /:ro$/);
	});

	it("mounts no docker socket", () => {
		assert.ok(
			!body.includes("docker.sock"),
			"D9: the checker reads a file, not the daemon",
		);
	});

	it("keeps its state volume off every other service", () => {
		const holders = Object.entries(blocks)
			.filter(([, lines]) =>
				keyed(lines, "volumes").some((entry) =>
					entry.startsWith("doctor_state:"),
				),
			)
			.map(([name]) => name)
			.sort();
		// volume-init creates and chowns it; nothing else reads or writes it.
		assert.deepEqual(holders, ["doctor", "volume-init"]);
	});

	it("publishes no port", () => {
		assert.deepEqual(keyed(doctor, "ports"), []);
	});

	it("takes no env_file, so the container that talks to a SaaS holds no secret", () => {
		assert.ok(!body.includes("env_file"));
		assert.ok(!body.includes("*app-env"));
	});

	it("passes through both alerting variables, and the thresholds", () => {
		const environment = keyed(doctor, "environment");
		for (const name of [
			"DOCTOR_WEBHOOK_URL",
			"DOCTOR_HEARTBEAT_URL",
			"DOCTOR_WEBHOOK_TEMPLATE",
			"DOCTOR_WEBHOOK_CONTENT_TYPE",
			"DOCTOR_INTERVAL_SECONDS",
			"DOCTOR_DWELL_CHECKS",
			"DOCTOR_SYNC_AGE_MAX_SECONDS",
			"DOCTOR_HEARTBEAT_MAX_AGE_SECONDS",
			"DOCTOR_AUTH_FAILURE_HOLD_SECONDS",
			"DOCTOR_LOG_LEVEL",
		]) {
			assert.ok(
				environment.some((entry) => entry.startsWith(`${name}: `)),
				`doctor must pass ${name} through from .env`,
			);
		}
	});

	it("carries no application configuration it has no use for", () => {
		const environment = keyed(doctor, "environment");
		for (const entry of environment) {
			assert.match(
				entry,
				// NODE_OPTIONS is the runtime's own memory ceiling, shared with every
				// other Node service (compose-heap.test.mjs). It names no path, no
				// endpoint and no credential, so it holds nothing a payload could leak.
				/^(DOCTOR_|NODE_OPTIONS:)/,
				`doctor's environment must hold DOCTOR_* only, found: ${entry}`,
			);
		}
	});

	it("comes back after a crash or a reboot", () => {
		assert.match(body, /^ {4}restart: unless-stopped$/m);
	});

	it("waits only on the volume it writes, never on the stack it watches", () => {
		assert.deepEqual(keyed(doctor, "depends_on"), ["volume-init:"]);
	});

	it("declares the state volume", () => {
		assert.match(text, /^ {2}doctor_state:$/m);
	});
});

describe("the exec seam", () => {
	it("is documented in the compose file, where the operator finds the service", () => {
		assert.match(text, /exec -T doctor node check\.mjs/);
	});
});
