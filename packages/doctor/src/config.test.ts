import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig, parseTargets } from "./config.js";

describe("loadConfig", () => {
	it("needs nothing set, and sends nothing when nothing is set", () => {
		const config = loadConfig({});
		assert.equal(config.webhookUrl, undefined);
		assert.equal(config.deadManUrl, undefined);
		assert.equal(config.dwellChecks, 3);
		assert.equal(config.intervalMs, 60_000);
		assert.deepEqual(
			config.targets.map((target) => target.service),
			["backend", "queue", "imap-worker", "smtp-worker"],
		);
		assert.deepEqual(config.heartbeatServices, [
			"imap-worker",
			"smtp-worker",
			"account-worker",
			"search-index-worker",
		]);
		assert.equal(config.tlsMode, "off");
		assert.equal(config.tunnelReadyUrl, "http://tunnel:2000/ready");
	});

	it("takes the deployment's serving mode and the edge's readiness endpoint", () => {
		const config = loadConfig({
			DOCTOR_TLS_MODE: "tunnel",
			DOCTOR_TUNNEL_READY_URL: "http://edge:9000/healthz",
		});
		assert.equal(config.tlsMode, "tunnel");
		assert.equal(config.tunnelReadyUrl, "http://edge:9000/healthz");
	});

	it("refuses a webhook with no dead-man's switch, naming both variables", () => {
		assert.throws(
			() => loadConfig({ DOCTOR_WEBHOOK_URL: "https://hooks.example/x" }),
			(error: Error) => {
				assert.match(error.message, /DOCTOR_WEBHOOK_URL/);
				assert.match(error.message, /DOCTOR_HEARTBEAT_URL/);
				return true;
			},
		);
	});

	it("accepts a dead-man's switch with no webhook", () => {
		const config = loadConfig({ DOCTOR_HEARTBEAT_URL: "https://hc.example/x" });
		assert.equal(config.deadManUrl, "https://hc.example/x");
	});

	it("treats a blank value as unset, so an empty compose passthrough is not a webhook", () => {
		const config = loadConfig({
			DOCTOR_WEBHOOK_URL: "   ",
			DOCTOR_HEARTBEAT_URL: "",
		});
		assert.equal(config.webhookUrl, undefined);
		assert.equal(config.deadManUrl, undefined);
	});

	it("refuses a threshold that is not a positive number, by name", () => {
		assert.throws(
			() => loadConfig({ DOCTOR_SYNC_AGE_MAX_SECONDS: "soon" }),
			/DOCTOR_SYNC_AGE_MAX_SECONDS/,
		);
		assert.throws(
			() => loadConfig({ DOCTOR_DWELL_CHECKS: "0" }),
			/DOCTOR_DWELL_CHECKS/,
		);
		assert.throws(
			() => loadConfig({ DOCTOR_INTERVAL_SECONDS: "-5" }),
			/DOCTOR_INTERVAL_SECONDS/,
		);
	});

	it("reads the overrides an operator is expected to set", () => {
		const config = loadConfig({
			DOCTOR_INTERVAL_SECONDS: "15",
			DOCTOR_DWELL_CHECKS: "2",
			DOCTOR_SYNC_AGE_MAX_SECONDS: "600",
			DOCTOR_HEARTBEAT_MAX_AGE_SECONDS: "120",
			DOCTOR_HEARTBEAT_DIR: "/tmp/hb",
			DOCTOR_HEARTBEAT_SERVICES: "imap-worker, smtp-worker",
			DOCTOR_STATE_DIR: "/tmp/state",
			DOCTOR_WEBHOOK_CONTENT_TYPE: "text/plain",
			DOCTOR_WEBHOOK_TEMPLATE: "{{summary}}",
			DOCTOR_HEARTBEAT_URL: "https://hc.example/x",
			DOCTOR_WEBHOOK_URL: "https://ntfy.example/remit",
		});
		assert.equal(config.intervalMs, 15_000);
		assert.equal(config.dwellChecks, 2);
		assert.equal(config.syncAgeMaxSeconds, 600);
		assert.equal(config.heartbeatMaxAgeSeconds, 120);
		assert.equal(config.heartbeatDir, "/tmp/hb");
		assert.deepEqual(config.heartbeatServices, ["imap-worker", "smtp-worker"]);
		assert.equal(config.stateDir, "/tmp/state");
		assert.equal(config.webhookContentType, "text/plain");
		assert.equal(config.webhookTemplate, "{{summary}}");
	});
});

describe("parseTargets", () => {
	it("reads service=url pairs", () => {
		assert.deepEqual(
			parseTargets("a=http://a:1/metrics, b=http://b:2/metrics"),
			[
				{ service: "a", url: "http://a:1/metrics" },
				{ service: "b", url: "http://b:2/metrics" },
			],
		);
	});

	it("keeps the whole url, colons and all", () => {
		assert.deepEqual(parseTargets("a=http://a:9464/metrics"), [
			{ service: "a", url: "http://a:9464/metrics" },
		]);
	});

	it("refuses an entry with no service name", () => {
		assert.throws(() => parseTargets("http://a/metrics"), /DOCTOR_TARGETS/);
		assert.throws(() => parseTargets("=http://a/metrics"), /DOCTOR_TARGETS/);
	});

	it("reads an empty list as no targets", () => {
		assert.deepEqual(loadConfig({ DOCTOR_TARGETS: " , " }).targets, []);
	});
});
