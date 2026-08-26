#!/usr/bin/env node --import tsx
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldVerifyDiscoveryTls } from "@remit/auth-service/edge-tls";
import {
	assertPublicRoutesExist,
	buildRoutes,
	renderConfig,
} from "./src/route-table.js";

/**
 * Generate the APISIX standalone (etcd-less) route table from the OpenAPI spec.
 *
 * Every business route is guarded by the openid-connect plugin in bearer_only
 * mode, which verifies the better-auth RS256 JWT against the JWKS it discovers
 * and follows key rotation automatically. better-auth's own endpoints
 * (`/api/auth/*`) stay public — that is where tokens are minted and the JWKS is
 * served — as does each path in `PUBLIC_ROUTES`. The backend re-verifies the JWT
 * and derives identity itself, so the edge only needs to gate — it forwards no
 * identity header.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const BACKEND_HOST = process.env.APISIX_BACKEND_HOST ?? "host.docker.internal";
const BACKEND_PORT = Number(process.env.APISIX_BACKEND_PORT ?? "5436");
const DISCOVERY_URL =
	process.env.APISIX_OIDC_DISCOVERY ??
	`http://${BACKEND_HOST}:${BACKEND_PORT}/api/auth/.well-known/openid-configuration`;

interface OpenApiSpec {
	paths: Record<string, unknown>;
}

const yamlEscape = (value: string): string => value.replace(/'/g, "''");

const spec: OpenApiSpec = JSON.parse(
	readFileSync(
		resolve(REPO_ROOT, "build/remit-openapi3/openapi.json"),
		"utf-8",
	),
);

const sslVerify = shouldVerifyDiscoveryTls(DISCOVERY_URL);

const oidcPlugin = `      openid-connect:
        bearer_only: true
        use_jwks: true
        ssl_verify: ${sslVerify}
        discovery: '${yamlEscape(DISCOVERY_URL)}'
        client_id: remit-web
        client_secret: unused-in-bearer-only
        set_userinfo_header: false
        set_id_token_header: false`;

const paths = Object.keys(spec.paths);
assertPublicRoutesExist(paths);

const config = renderConfig({
	routes: buildRoutes(paths),
	oidcPlugin,
	backendHost: BACKEND_HOST,
	backendPort: BACKEND_PORT,
});

const outPath = resolve(__dirname, "apisix.yaml");
writeFileSync(outPath, config);
console.log(`apisix: wrote ${paths.length} business routes → ${outPath}`);
