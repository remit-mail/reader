// Caddy decides the client address for everything behind it, so
// X-Forwarded-For has to leave it holding exactly one entry: better-auth keys
// its per-path rate limits on a chain it can attribute to one client and falls
// back to a single shared bucket for a chain it cannot — a five-per-minute
// sign-in limit any one client can spend for everybody (#617, #567 D5).
//
// The behavioural half runs the deployment's own Caddy image over the committed
// routes.caddy, in front of an upstream that answers with the header it was
// handed, and reads the result out of a real proxied request. It covers both
// site shapes the routing table is imported into: the :80 site that ships
// today, where Caddy trusts nothing and terminates the client connection
// itself, and a site behind a trusted edge, where the default is to extend the
// chain the edge sent rather than state one address.
//
// The structural half pins the directive on every route, so a route added later
// cannot quietly ship without it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CADDY_DIR = join(ROOT, "deploy", "vps", "caddy");
const ROUTES = readFileSync(join(CADDY_DIR, "routes.caddy"), "utf8");

const DIRECTIVE = "header_up X-Forwarded-For {client_ip}";

/**
 * Every `reverse_proxy` in the file paired with the body of its block, brace-
 * matched rather than pattern-matched, so a proxy that carries the directive
 * cannot vouch for a neighbour that does not.
 */
const reverseProxyBlocks = (source) => {
	const blocks = [];
	for (const match of source.matchAll(/^[ \t]*reverse_proxy\b(.*)$/gm)) {
		const upstream = match[1].replace("{", "").trim();
		const open = source.indexOf("{", match.index);
		const lineEnd = source.indexOf("\n", match.index);
		if (open < 0 || open > lineEnd) {
			blocks.push({ upstream, body: "" });
			continue;
		}
		let depth = 0;
		let end = open;
		for (let index = open; index < source.length; index += 1) {
			if (source[index] === "{") depth += 1;
			if (source[index] === "}") {
				depth -= 1;
				if (depth === 0) {
					end = index;
					break;
				}
			}
		}
		blocks.push({ upstream, body: source.slice(open + 1, end) });
	}
	return blocks;
};

describe("the routing table states the client address on every proxy", () => {
	const blocks = reverseProxyBlocks(ROUTES);

	it("finds the proxies this suite reasons about", () => {
		assert.ok(
			blocks.length >= 5,
			`parsed ${blocks.length} reverse_proxy blocks in routes.caddy — the walk broke`,
		);
	});

	for (const [index, block] of blocks.entries()) {
		const name = block.upstream || `proxy #${index}`;
		it(`replaces X-Forwarded-For on the proxy to ${name}`, () => {
			assert.ok(
				block.body.includes(DIRECTIVE),
				`${name} passes X-Forwarded-For to its upstream untouched; it needs \`${DIRECTIVE}\``,
			);
			assert.ok(
				!block.body.includes("+X-Forwarded-For"),
				`${name}: a \`+\` prefix appends a hop instead of replacing the header`,
			);
		});
	}
});

const containerRuntime = () => {
	for (const candidate of ["docker", "podman"]) {
		if (spawnSync(candidate, ["info"], { stdio: "ignore" }).status === 0) {
			return candidate;
		}
	}
	// A missing runtime is a fact about a developer's machine and never about
	// CI: skipping there would leave a suite that reports green without having
	// proxied anything.
	if (process.env.CI) {
		throw new Error(
			"no container runtime found — the X-Forwarded-For proxy check needs docker or podman",
		);
	}
	console.log(
		"skipping the proxied-request checks — no container runtime on this machine",
	);
	return null;
};

const CR = containerRuntime();

if (CR) {
	const IMAGE = "caddy:2-alpine";
	// Documentation addresses (RFC 5737), so a leak into an assertion cannot
	// match a real peer.
	const FORGED = ["203.0.113.9", "203.0.113.44"];
	const EDGE_CLIENT = "198.51.100.77";
	const CLIENT_IP_HEADER = "Cf-Connecting-Ip";

	// The site shape a tunnelled deployment serves: the browser reaches an edge,
	// the edge reaches Caddy from inside the private ranges, and the address to
	// believe is the one the edge overwrites on every request. Trusting that hop
	// is what makes Caddy extend an inbound X-Forwarded-For by default.
	const BEHIND_TRUSTED_EDGE = `{
	servers {
		trusted_proxies static private_ranges
		client_ip_headers ${CLIENT_IP_HEADER}
	}
}

:80 {
	import /etc/caddy/routes.caddy
}
`;

	const ECHO_CADDYFILE = [":9080", ":8080"]
		.map(
			(address) =>
				`${address} {\n\trespond "{http.request.header.X-Forwarded-For}" 200\n}\n`,
		)
		.join("\n");

	const PATHS = [
		"/health",
		"/api/auth/sign-in/email",
		"/api/accounts",
		"/content/anything",
		"/",
	];

	const run = (...args) => execFileSync(CR, args, { encoding: "utf8" }).trim();

	const singleEntry = (seen, path) => {
		assert.ok(seen.length > 0, `${path}: the upstream saw no client address`);
		assert.ok(
			!seen.includes(","),
			`${path}: the upstream saw a multi-hop chain "${seen}"`,
		);
	};

	const cases = [
		{
			title: "on the site that terminates the client connection",
			caddyfile: readFileSync(join(CADDY_DIR, "off.caddy"), "utf8"),
			headers: { "X-Forwarded-For": FORGED.join(", ") },
			check: (seen, path) => {
				singleEntry(seen, path);
				for (const forged of FORGED) {
					assert.ok(
						!seen.includes(forged),
						`${path}: a client-supplied address survived as "${seen}"`,
					);
				}
			},
		},
		{
			title: "on a site behind a trusted edge",
			caddyfile: BEHIND_TRUSTED_EDGE,
			headers: {
				"X-Forwarded-For": FORGED.join(", "),
				[CLIENT_IP_HEADER]: EDGE_CLIENT,
			},
			check: (seen, path) => {
				singleEntry(seen, path);
				assert.equal(
					seen,
					EDGE_CLIENT,
					`${path}: the upstream saw "${seen}" instead of the address the edge stated`,
				);
			},
		},
	];

	for (const [index, testCase] of cases.entries()) {
		describe(`a proxied request carries one client address ${testCase.title}`, () => {
			const stamp = `remit-xff-${process.pid}-${index}`;
			const network = `${stamp}-net`;
			const echo = `${stamp}-echo`;
			const edge = `${stamp}-edge`;
			let workdir = "";
			let origin = "";

			before(async () => {
				mkdirSync(join(ROOT, ".tmp"), { recursive: true });
				workdir = mkdtempSync(join(ROOT, ".tmp", "xff-"));
				writeFileSync(join(workdir, "echo.caddy"), ECHO_CADDYFILE);
				writeFileSync(join(workdir, "site.caddy"), testCase.caddyfile);

				run("network", "create", network);
				// One image for both ends: the upstream is the same Caddy, answering
				// with the header it was handed, so this pulls nothing the deployment
				// does not already run. It answers to all three service names the
				// routing table dials, so every route in it lands here.
				run(
					"run",
					"-d",
					"--name",
					echo,
					"--network",
					network,
					"--network-alias",
					"apisix",
					"--network-alias",
					"backend",
					"--network-alias",
					"web",
					"-v",
					`${join(workdir, "echo.caddy")}:/etc/caddy/Caddyfile:ro`,
					IMAGE,
				);
				// routes.caddy is mounted where docker-compose.sqlite.yml mounts it,
				// and imported by the site file exactly as a deployment imports it.
				run(
					"run",
					"-d",
					"--name",
					edge,
					"--network",
					network,
					"-p",
					"127.0.0.1::80",
					"-v",
					`${join(CADDY_DIR, "routes.caddy")}:/etc/caddy/routes.caddy:ro`,
					"-v",
					`${join(workdir, "site.caddy")}:/etc/caddy/Caddyfile:ro`,
					IMAGE,
				);
				origin = `http://${run("port", edge, "80/tcp").split("\n")[0].trim()}`;

				for (let attempt = 0; attempt < 80; attempt += 1) {
					const answered = await fetch(`${origin}/health`).catch(() => null);
					if (answered) return;
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
				throw new Error(`the edge never answered:\n${run("logs", edge)}`);
			});

			after(() => {
				for (const name of [edge, echo]) {
					spawnSync(CR, ["rm", "-f", name], { stdio: "ignore" });
				}
				spawnSync(CR, ["network", "rm", network], { stdio: "ignore" });
				if (workdir) rmSync(workdir, { recursive: true, force: true });
			});

			for (const path of PATHS) {
				it(`hands the upstream one entry on ${path}`, async () => {
					const response = await fetch(`${origin}${path}`, {
						headers: testCase.headers,
					});
					testCase.check((await response.text()).trim(), path);
				});
			}
		});
	}
}
