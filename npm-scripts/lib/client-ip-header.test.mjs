// The address better-auth rate-limits on reaches it in one header and no other
// way: the edge states it (routes.caddy) and packages/auth-service names it. No
// environment variable carries that name between them, so all that holds the
// two ends together is spelling it the same — and a mode file that skips the
// routes.caddy import states no address at all. Either way better-auth resolves
// nothing and counts every client into one shared bucket (#1055). What the edge
// does with the header once it states it — replacing a client's copy rather
// than appending to it — is proven end to end against a real Caddy in
// tls-mode-tunnel.test.mjs; this suite pins only the two agreements that no
// running stack can catch, because they are agreements between files.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CADDY_DIR = join(ROOT, "deploy", "vps", "caddy");
// Discovered, not hardcoded — a mode file added later must pass this guard
// too, not be silently exempt from it.
const MODE_FILES = readdirSync(CADDY_DIR).filter(
	(name) => name.endsWith(".caddy") && name !== "routes.caddy",
);

const ROUTES = readFileSync(join(CADDY_DIR, "routes.caddy"), "utf8");
const AUTH = readFileSync(
	join(ROOT, "packages", "auth-service", "src", "auth.ts"),
	"utf8",
);

// Captured with \S+ rather than the bare name: a `+` prefix would make Caddy
// append instead of replace, and that spelling must fail the match below
// rather than pass as the same header.
const stated = ROUTES.match(/^request_header (\S+) \{client_ip\}$/m)?.[1];
const read = AUTH.match(/^export const CLIENT_IP_HEADER = "(.+)";$/m)?.[1];

describe("the client address the edge states", () => {
	it("finds the mode files this suite reasons about", () => {
		assert.ok(
			MODE_FILES.includes("off.caddy"),
			"discovery found no *.caddy files under deploy/vps/caddy — the walk broke",
		);
	});

	it("carries the name auth-service reads", () => {
		assert.ok(stated, "routes.caddy sets no request header from {client_ip}");
		assert.ok(read, "auth-service exports no CLIENT_IP_HEADER");
		assert.equal(
			stated.toLowerCase(),
			read.toLowerCase(),
			`the edge states "${stated}" and auth-service reads "${read}", so no address resolves`,
		);
	});

	it("is stated in every TLS mode", () => {
		for (const file of MODE_FILES) {
			assert.match(
				readFileSync(join(CADDY_DIR, file), "utf8"),
				/^\s*import \/etc\/caddy\/routes\.caddy$/m,
				`${file}: no routes.caddy import, so this mode states no address`,
			);
		}
	});
});
