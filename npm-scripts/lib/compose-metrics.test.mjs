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

// Services at two-space indent, their `ports:`/`profiles:` at four, entries at
// six.
function serviceBlocks(source) {
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
			result[service] = { ports: [], profiles: [] };
			inPorts = false;
			continue;
		}
		if (!service) continue;
		const profiles = line.match(/^ {4}profiles:\s*\[(.*)\]\s*$/);
		if (profiles) {
			result[service].profiles = profiles[1]
				.split(",")
				.map((name) => name.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
			continue;
		}
		if (/^ {4}ports:/.test(line)) {
			inPorts = true;
			continue;
		}
		if (inPorts) {
			const entry = line.match(/^ {6}- (.+?)\s*$/);
			if (entry) {
				result[service].ports.push(entry[1].replace(/^["']|["']$/g, ""));
				continue;
			}
			if (/^ {2,4}\S/.test(line)) inPorts = false;
		}
	}
	return result;
}

const blocks = serviceBlocks(COMPOSE);
const ports = Object.fromEntries(
	Object.entries(blocks).map(([service, block]) => [service, block.ports]),
);
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
	it("leaves caddy the only service reachable off the host", () => {
		const reachable = published
			.filter(([, entries]) =>
				entries.some((entry) => !entry.startsWith("127.0.0.1:")),
			)
			.map(([service]) => service);
		assert.deepEqual(reachable, ["caddy"]);
	});
});

// D13. Both UIs are unauthenticated views of data that must not leave the box —
// every container's log lines, and every series including the per-account ones.
// The loopback bind is the access control, so it is asserted, not assumed: an
// operator reaches them over an SSH tunnel or the box's tailnet.
describe("the observability profile binds loopback and nothing else", () => {
	const observability = Object.entries(blocks)
		.filter(([, block]) => block.profiles.includes("observability"))
		.map(([service]) => service);

	it("is exactly dozzle and victoriametrics", () => {
		assert.deepEqual(observability.sort(), ["dozzle", "victoriametrics"]);
	});

	it("is the only thing that publishes a loopback port", () => {
		const loopback = published
			.filter(([, entries]) =>
				entries.some((entry) => entry.startsWith("127.0.0.1:")),
			)
			.map(([service]) => service);
		assert.deepEqual(loopback.sort(), ["dozzle", "victoriametrics"]);
	});

	it("binds every one of its published ports to 127.0.0.1", () => {
		for (const service of observability) {
			for (const entry of ports[service]) {
				assert.match(
					entry,
					/^127\.0\.0\.1:/,
					`${service} publishes ${entry}, which is reachable off the host`,
				);
			}
		}
	});

	it("leaves the host address literal, however the port is configured", () => {
		for (const service of observability) {
			for (const entry of ports[service]) {
				assert.ok(
					!/^\$\{|^"?\$\{/.test(entry),
					`${service}'s bind address comes from ${entry}, so .env can move it off loopback`,
				);
			}
		}
	});

	it("stays off unless the profile is asked for", () => {
		for (const service of observability) {
			assert.deepEqual(blocks[service].profiles, ["observability"]);
		}
	});
});

describe("the observability profile is not reachable through Caddy", () => {
	it("routes to no observability upstream", () => {
		for (const { matcher, upstreams } of routes) {
			for (const upstream of upstreams) {
				const host = upstream.split(":")[0];
				assert.ok(
					!["dozzle", "victoriametrics"].includes(host),
					`caddy routes ${matcher} to ${host}`,
				);
			}
		}
	});

	it("routes no path that reads as one of their UIs", () => {
		for (const { matcher } of routes) {
			assert.ok(
				!/vmui|dozzle/.test(matcher),
				`caddy routes ${matcher}, which reaches an observability UI`,
			);
		}
	});
});

// The scrape list is the second half of "is it actually being collected": a
// target silently dropped from this file is a signal that stops existing without
// anything failing.
describe("VictoriaMetrics scrapes every service that owns a signal", () => {
	const scrape = readFileSync(
		join(ROOT, "deploy", "vps", "observability", "scrape.yml"),
		"utf8",
	);
	const targets = [...scrape.matchAll(/- targets: \["([^"]+)"\]/g)].map(
		(match) => match[1],
	);

	it("names the six endpoints D3 assigns a signal to", () => {
		assert.deepEqual(targets.sort(), [
			"account-worker:9464",
			"backend:8080",
			"imap-worker:9464",
			"queue:9324",
			"search-index-worker:9464",
			"smtp-worker:9464",
		]);
	});

	it("scrapes nothing outside the compose network", () => {
		for (const target of targets) {
			assert.ok(
				Object.hasOwn(blocks, target.split(":")[0]),
				`${target} is not a service in this compose file`,
			);
		}
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

	it("proxies to the backend only on the signed-URL paths, never /metrics", () => {
		const backendRoutes = routes.filter(({ upstreams }) =>
			upstreams.some((upstream) => upstream.startsWith("backend:")),
		);
		// The two that carry their own authority in the URL and so cannot go
		// through the edge's bearer gate: content out, an attachment upload in.
		// Every other backend path is reached through apisix.
		assert.deepEqual(
			backendRoutes.map(({ matcher }) => matcher),
			["/content/*", "/outbox-upload/*"],
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
