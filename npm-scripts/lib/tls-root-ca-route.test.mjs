// The Settings > Advanced download row (packages/web-client) fetches the
// deployment's TLS root CA from a stable Caddy route (deploy/vps/README.md,
// "TLS", has the rationale). Guards: the route exists in internal.caddy only,
// ordered before the routes.caddy import so its catch-all cannot swallow it,
// and it never rewrites to a key file instead of the certificate.
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

const read = (name) => readFileSync(join(CADDY_DIR, name), "utf8");

describe("the TLS root CA route", () => {
	it("finds the mode files this suite reasons about", () => {
		assert.ok(
			MODE_FILES.includes("internal.caddy"),
			"discovery found no *.caddy files under deploy/vps/caddy — the walk broke",
		);
	});

	it("exists only in internal.caddy", () => {
		for (const file of MODE_FILES) {
			const hasRoute = read(file).includes("/tls-root-ca.crt");
			assert.equal(
				hasRoute,
				file === "internal.caddy",
				`${file}: expected /tls-root-ca.crt route ${
					file === "internal.caddy" ? "" : "NOT "
				}present`,
			);
		}
	});

	it("is declared before the routes.caddy import, so its catch-all cannot swallow it", () => {
		const source = read("internal.caddy");
		const routeIndex = source.indexOf("/tls-root-ca.crt");
		const importIndex = source.indexOf("import /etc/caddy/routes.caddy");
		assert.ok(routeIndex >= 0, "route not found in internal.caddy");
		assert.ok(
			importIndex >= 0,
			"routes.caddy import not found in internal.caddy",
		);
		assert.ok(
			routeIndex < importIndex,
			"the CA route must be declared before the routes.caddy import",
		);
	});

	it("points at the root CA Caddy's own PKI storage, not the leaf", () => {
		const source = read("internal.caddy");
		assert.match(source, /\/data\/caddy\/pki\/authorities\/local/);
	});

	// The Content-Disposition filename also contains the substring "root.crt"
	// (reader-root.crt), so a bare `/root\.crt/` match is satisfied by that
	// header alone and never looks at what `rewrite` actually serves. Anchored
	// to the `rewrite` line specifically, with an explicit negative: a
	// same-directory swap to root.key/intermediate.key (the CA private keys)
	// would otherwise pass every other assertion here and publish a key at this
	// unauthenticated, guessable URL.
	it("rewrites to the root certificate specifically, never a key file", () => {
		const source = read("internal.caddy");
		assert.match(source, /rewrite \* \/root\.crt$/m);
		assert.doesNotMatch(source, /rewrite \* \/\S*\.key\b/);
	});

	it("serves it as a download with an x509 CA content type", () => {
		const source = read("internal.caddy");
		assert.match(source, /Content-Disposition/);
		assert.match(source, /attachment/);
		assert.match(source, /application\/x-x509-ca-cert/);
	});
});

describe("the web service learns TLS_MODE", () => {
	it("passes it through in docker-compose.sqlite.yml, same default as caddy's own Caddyfile mount", () => {
		const compose = readFileSync(
			join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml"),
			"utf8",
		);
		const webBlock = compose.slice(
			compose.indexOf("\n  web:"),
			compose.indexOf("\n  caddy:"),
		);
		assert.match(webBlock, /TLS_MODE:\s*\$\{TLS_MODE:-off\}/);
	});
});
