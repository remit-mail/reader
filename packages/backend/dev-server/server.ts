#!/usr/bin/env node --import tsx

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { APIGatewayProxyResult } from "aws-lambda";
import { env } from "expect-env";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import * as swaggerUi from "swagger-ui-express";
import { handler, OpenAPISpec } from "../src/index.js";
import { safeJsonParse } from "../src/json.js";
import { authorizeContentRequest } from "./content-auth.js";
import { resolveContentPath } from "./content-path.js";
import { parseAllowedOrigins, resolveAllowOrigin } from "./cors.js";
import { createLambdaContext, createLambdaEvent } from "./lambda-helpers.js";

const app = express();

// CORS is driven by CORS_ALLOWED_ORIGINS (comma-separated, or `*`). In Postgres
// mode it is required config — refuse to start if unset, so the deployed edge is
// never accidentally wide open by omission. Outside Postgres mode (AWS-local dev)
// it defaults to `*` to keep the existing local flow working.
const configuredCorsOrigins = parseAllowedOrigins(
	process.env.CORS_ALLOWED_ORIGINS,
);
if (
	process.env.DATA_BACKEND === "postgres" &&
	configuredCorsOrigins.length === 0
) {
	throw new Error(
		"Missing required env var CORS_ALLOWED_ORIGINS (comma-separated origins, or '*')",
	);
}
const corsAllowedOrigins =
	configuredCorsOrigins.length > 0 ? configuredCorsOrigins : ["*"];

// better-auth owns identity in Postgres mode. Its handler must be mounted
// BEFORE express.json() (better-auth reads the raw body itself; a prior json
// parser leaves its fetch calls hanging). This mirrors the production edge where
// the same better-auth service sits in front of the API.
if (process.env.DATA_BACKEND === "postgres") {
	// Synthetic OIDC discovery document for the APISIX edge tier. better-auth
	// serves a JWKS but not a discovery doc; APISIX's openid-connect plugin needs
	// one to locate the JWKS. Registered before the better-auth catch-all so it
	// is not shadowed. `issuer` matches the token `iss`; `jwks_uri` must be
	// reachable from wherever APISIX runs, hence derived from BETTER_AUTH_URL.
	app.get(
		"/api/auth/.well-known/openid-configuration",
		(_req: Request, res: Response) => {
			const base =
				process.env.BETTER_AUTH_URL ??
				`http://localhost:${process.env.SERVER_PORT ?? "5436"}`;
			res.json({
				issuer: base,
				jwks_uri: `${base}/api/auth/jwks`,
				authorization_endpoint: `${base}/api/auth/authorize`,
				token_endpoint: `${base}/api/auth/token`,
				response_types_supported: ["token"],
				subject_types_supported: ["public"],
				id_token_signing_alg_values_supported: ["RS256"],
			});
		},
	);

	const { createAuth, resolveAuthConfig, toNodeHandler } = await import(
		"@remit/auth-service"
	);
	const auth = createAuth(resolveAuthConfig());
	app.all(/^\/api\/auth\//, toNodeHandler(auth));
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
	const allowOrigin = resolveAllowOrigin(
		req.headers.origin,
		corsAllowedOrigins,
	);
	if (allowOrigin) {
		res.header("Access-Control-Allow-Origin", allowOrigin);
		if (allowOrigin !== "*") res.header("Vary", "Origin");
	}
	res.header(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, OPTIONS, PATCH",
	);
	res.header(
		"Access-Control-Allow-Headers",
		"Origin, X-Requested-With, Content-Type, Accept, Authorization",
	);

	if (req.method === "OPTIONS") {
		res.sendStatus(200);
	} else {
		next();
	}
});

app.get("/.well-known/appspecific/com.chrome.devtools.json", () => ({}));

app.get("/health", (_req: Request, res: Response) => {
	res.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		service: "remit-backend-local",
	});
});

// Swagger UI exposes the full API schema, so it must never be on the public
// surface. On the Postgres stack this server is the deployed backend container;
// gate the docs to non-Postgres (AWS-local dev) only. The generated OpenAPI
// document is still consumed programmatically by the APISIX edge via its own
// mounted paths — this only removes the browsable UI from the deployed surface.
if (process.env.DATA_BACKEND !== "postgres") {
	const localSpec = { ...OpenAPISpec };
	if (localSpec.servers) {
		localSpec.servers[0].url = "/";
	}
	app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(localSpec));
}

// Local stand-in for the CloudFront `/content/*` behavior. In production the
// Lambda@Edge JWT verifier guards these requests and CloudFront serves them
// from the storage S3 bucket via OAC. Locally we stream the bytes from the
// filesystem-backed storage location keyed by URL path. No JWT check — this
// server only runs against an isolated dev/e2e DynamoDB + storage tree.
//
// `LOCAL_CONTENT_STORAGE_BASE` lets the e2e/smoke fixture point this server at
// the same absolute filesystem root it seeded under (repo-relative), since
// the fixture writes from the repo root while the dev-server's cwd is the
// playwright workspace.
const STORAGE_LOCAL_PATH = process.env.STORAGE_LOCAL_PATH ?? ".remit/storage";
const STORAGE_BASE = resolve(
	process.env.LOCAL_CONTENT_STORAGE_BASE ?? process.cwd(),
	STORAGE_LOCAL_PATH,
);

app.get(/^\/content\/.+$/, async (req: Request, res: Response) => {
	const storageKey = req.path.replace(/^\/content\//, "");

	// On the Postgres stack this route is the deployed content-delivery surface;
	// require a valid signed URL (HMAC + expiry, scoped to the owning account)
	// before touching storage. Bearer auth can't ride on an `<img src>` content
	// load, so the signature carried in the query string is the authorization.
	const auth = authorizeContentRequest({
		dataBackend: process.env.DATA_BACKEND,
		secret: process.env.BETTER_AUTH_SECRET,
		relativePath: storageKey,
		exp: typeof req.query.exp === "string" ? req.query.exp : undefined,
		sig: typeof req.query.sig === "string" ? req.query.sig : undefined,
		nowSeconds: Math.floor(Date.now() / 1000),
	});
	if (!auth.authorized) {
		res.status(auth.status).setHeader("x-remit-403-reason", auth.reason);
		res.send(auth.reason);
		return;
	}

	const fullPath = resolveContentPath(STORAGE_BASE, storageKey);
	if (fullPath === null) {
		res.status(400).send("invalid path");
		return;
	}
	const raw = await readFile(fullPath).catch(() => null);
	if (!raw) {
		res.status(404).send("not found");
		return;
	}
	// The filesystem storage backend gzip-compresses every body part (same as
	// S3, which sets ContentEncoding: gzip so CloudFront auto-decompresses).
	// In dev there is no CloudFront, so we decompress here before sending.
	const buffer = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
	res.setHeader("content-type", "application/octet-stream");
	res.send(buffer);
});

app.all(/(.*)/, async (req: Request, res: Response) => {
	const event = createLambdaEvent(req);
	const context = createLambdaContext();

	const result: APIGatewayProxyResult = await handler(event, context);
	const headers = (result.headers ?? {}) as Record<string, string>;

	let body: unknown = result.body;

	if (
		typeof body === "string" &&
		headers["Content-Type"]?.includes("application/json")
	) {
		const parsed = await safeJsonParse<unknown>(body).catch(() => undefined);
		if (parsed === undefined) {
			console.error("[dev-server] Failed to parse JSON body");
		} else if (
			parsed &&
			typeof parsed === "object" &&
			"statusCode" in parsed &&
			"body" in parsed
		) {
			const inner = (parsed as { body: unknown }).body;
			body =
				typeof inner === "string"
					? await safeJsonParse(inner).catch(() => inner)
					: inner;
		} else {
			body = parsed;
		}
	}

	res
		.setHeaders(new Map(Object.entries(headers)))
		.status(result.statusCode)
		.send(body);
});

const port = env.SERVER_PORT;

app.listen(Number(port), "0.0.0.0", () => {
	console.log(`Remit Backend running on http://localhost:${port}`);
	console.log(
		`OpenAPI documentation available at http://localhost:${port}/api-docs`,
	);

	console.table({
		SERVER_PORT: port,
		DYNAMODB_PORT: env.DYNAMODB_PORT,
		DYNAMODB_TABLE: env.DYNAMODB_TABLE_NAME,
		NODE_ENV: env.NODE_ENV,
	});

	process.send?.("ready");
});

export default app;
