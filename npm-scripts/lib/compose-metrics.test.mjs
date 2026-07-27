// The reachability half of the metrics endpoint (docs/design/standalone-observability.md
// D2): `/metrics` is on the compose network only. That is a property of the
// deployment surface — which port is published, which path Caddy routes — so it
// is asserted against the committed compose file and Caddyfile rather than a
// running stack.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const COMPOSE = readFileSync(
	join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml"),
	"utf8",
);
const ROUTES = readFileSync(
	join(ROOT, "deploy", "vps", "caddy", "routes.caddy"),
	"utf8",
);

// Services at two-space indent, their `ports:` block at four, entries at six.
function servicePorts(source) {
	const result = {};
	let inServices = false;
	let service = null;
	let inPorts = false;
	for (const line of source.split("\n")) {
		if (/^services:\s*$/.test(line)) {
			inServices = true;
			continue;
		}
		if (!inServices) continue;
		if (/^\S/.test(line)) {
			inServices = false;
			service = null;
			inPorts = false;
			continue;
		}
		const svc = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
		if (svc) {
			service = svc[1];
			result[service] = [];
			inPorts = false;
			continue;
		}
		if (!service) continue;
		if (/^ {4}ports:/.test(line)) {
			inPorts = true;
			continue;
		}
		if (inPorts) {
			const entry = line.match(/^ {6}- (.+?)\s*$/);
			if (entry) {
				result[service].push(entry[1].replace(/^["']|["']$/g, ""));
				continue;
			}
			if (/^ {2,4}\S/.test(line)) inPorts = false;
		}
	}
	return result;
}

const ports = servicePorts(COMPOSE);
const published = Object.entries(ports).filter(
	([, entries]) => entries.length > 0,
);

// Every `route <matcher> {` block and the upstream it proxies to.
function caddyRoutes(source) {
	const routes = [];
	const lines = source.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const opened = lines[index].match(/^route\s*(\S*)\s*\{/);
		if (!opened) continue;
		const matcher = opened[1] || "*";
		const upstreams = [];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			if (/^\}/.test(lines[cursor])) break;
			const proxy = lines[cursor].match(/reverse_proxy\s+(\S+)/);
			if (proxy) upstreams.push(proxy[1]);
		}
		routes.push({ matcher, upstreams });
	}
	return routes;
}

const routes = caddyRoutes(ROUTES);

describe("the metrics endpoint is not published to the host", () => {
	it("leaves caddy the only service with a published port", () => {
		assert.deepEqual(
			published.map(([service]) => service),
			["caddy"],
		);
	});

	it("publishes only 80 and 443", () => {
		assert.deepEqual(ports.caddy, ["80:80", "443:443"]);
	});
});

describe("the metrics endpoint is not reachable through Caddy", () => {
	it("declares at least the routes this suite reasons about", () => {
		assert.ok(routes.length >= 5, "expected the routing table to be parsed");
	});

	it("routes no path containing /metrics", () => {
		for (const { matcher } of routes) {
			assert.ok(
				!matcher.includes("metrics"),
				`caddy routes ${matcher}, which reaches /metrics`,
			);
		}
	});

	it("sends anything unmatched to the static web server, which serves no metrics", () => {
		const fallback = routes.at(-1);
		assert.equal(fallback.matcher, "*");
		assert.deepEqual(fallback.upstreams, ["web:8080"]);
	});

	it("proxies to the backend on one path only, and it is not /metrics", () => {
		const backendRoutes = routes.filter(({ upstreams }) =>
			upstreams.some((upstream) => upstream.startsWith("backend:")),
		);
		assert.deepEqual(
			backendRoutes.map(({ matcher }) => matcher),
			["/content/*"],
		);
	});

	it("never proxies to a worker or to the queue sidecar", () => {
		const workers = [
			"imap-worker",
			"smtp-worker",
			"account-worker",
			"search-index-worker",
			"queue",
		];
		for (const { matcher, upstreams } of routes) {
			for (const upstream of upstreams) {
				const host = upstream.split(":")[0];
				assert.ok(
					!workers.includes(host),
					`caddy routes ${matcher} to ${host}`,
				);
			}
		}
	});
});

// The one container holding /var/run/docker.sock. D3 keeps update state where it
// already is, on the updater_state volume, rather than giving that container a
// network listener to re-export a fact `remit status` already prints.
describe("the updater gets no listener", () => {
	it("still binds no port", () => {
		assert.deepEqual(ports.updater, []);
	});
});
