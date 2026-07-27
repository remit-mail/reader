// The Settings > Advanced download row (packages/web-client) fetches the
// deployment's TLS root CA from a stable Caddy route. Only TLS_MODE=internal
// has a local root CA worth serving — acme and tailscale are already publicly
// trusted, and off is plain HTTP — so the route must exist in internal.caddy
// and nowhere else, and it must be declared before the routes.caddy import so
// the catch-all reverse_proxy there never swallows it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CADDY_DIR = join(ROOT, "deploy", "vps", "caddy");
const MODE_FILES = [
	"internal.caddy",
	"acme.caddy",
	"off.caddy",
	"tailscale.caddy",
];

const read = (name) => readFileSync(join(CADDY_DIR, name), "utf8");

describe("the TLS root CA route", () => {
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
		assert.match(source, /root\.crt/);
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
