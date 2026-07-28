import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "@remit/logger-lambda";
import {
	metricsContentType,
	onScrape,
	renderMetrics,
	setAccountSyncAges,
} from "@remit/logger-lambda/metrics";
import { isStorageNotFoundError } from "@remit/storage-service";
import type { APIGatewayProxyResult } from "aws-lambda";
import { env } from "expect-env";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { handler, OpenAPISpec } from "../src/index.js";
import { safeJsonParse } from "../src/json.js";
import { getClient } from "../src/service/data-client.js";
import { authorizeContentRequest } from "./content-auth.js";
import { serveContent } from "./content-handler.js";
import { resolveContentPath } from "./content-path.js";
import { parseAllowedOrigins, resolveAllowOrigin } from "./cors.js";
import { createLambdaContext, createLambdaEvent } from "./lambda-helpers.js";
import { checkRelationalStore } from "./relational-health.js";
import { collectAccountSyncAges } from "./sync-age.js";

const app = express();

// The self-host relational backend runs better-auth and the APISIX edge; the
// AWS-local (DynamoDB) dev path runs neither. Everything gated on "not the
// AWS-local path" keys off this.
const isSelfHostBackend = process.env.DATA_BACKEND === "sqlite";

// CORS is driven by CORS_ALLOWED_ORIGINS (comma-separated, or `*`). On the
// self-host backend it is required config — refuse to start if unset, so the
// deployed edge is never accidentally wide open by omission. On the AWS-local
// dev path it defaults to `*` to keep the existing local flow working.
const configuredCorsOrigins = parseAllowedOrigins(
	process.env.CORS_ALLOWED_ORIGINS,
);
if (isSelfHostBackend && configuredCorsOrigins.length === 0) {
	throw new Error(
		"Missing required env var CORS_ALLOWED_ORIGINS (comma-separated origins, or '*')",
	);
}
const corsAllowedOrigins =
	configuredCorsOrigins.length > 0 ? configuredCorsOrigins : ["*"];

// better-auth owns identity on the self-host backends. Its handler must be
// mounted BEFORE express.json() (better-auth reads the raw body itself; a prior
// json parser leaves its fetch calls hanging). This mirrors the production edge
// where the same better-auth service sits in front of the API.
if (isSelfHostBackend) {
	// Synthetic OIDC discovery document for the APISIX edge tier. better-auth
	// serves a JWKS but not a discovery doc; APISIX's openid-connect plugin needs
	// one to locate the JWKS. Registered before the better-auth catch-all so it
	// is not shadowed. `issuer` matches the token `iss`, so it stays the public
	// BETTER_AUTH_URL. `jwks_uri` is different: APISIX fetches it directly, and
	// on a deployment where the public origin isn't reachable from inside the
	// container network (a tailnet/VPN address a bridge network can't route to
	// — the shape deploy/vps's compose stack runs in), deriving it from
	// BETTER_AUTH_URL would point APISIX at an address it cannot reach, even
	// though it just reached this very endpoint fine.
	//
	// BETTER_AUTH_JWKS_URL — the same in-network override
	// remit-auth-service's own verifier config already reads
	// (packages/auth-service/src/config.ts) and every env file sets to
	// the backend's in-network address — is authoritative here, not the
	// incoming request's Host header: an operator-controlled value instead
	// of one derived from client-supplied input. It only falls back to
	// echoing the request's own host when unset, matching prior behavior
	// for any environment that doesn't set it.
	app.get(
		"/api/auth/.well-known/openid-configuration",
		(req: Request, res: Response) => {
			const base =
				process.env.BETTER_AUTH_URL ??
				`http://localhost:${process.env.SERVER_PORT ?? "5436"}`;
			const jwksUri =
				process.env.BETTER_AUTH_JWKS_URL ??
				`${req.protocol}://${req.get("host")}/api/auth/jwks`;
			res.json({
				issuer: base,
				jwks_uri: jwksUri,
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
	const auth = await createAuth(resolveAuthConfig());
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

app.get("/health", async (_req: Request, res: Response) => {
	const relationalStoreReachable = await checkRelationalStore();
	if (!relationalStoreReachable) {
		res.status(503).json({ status: "unhealthy" });
		return;
	}
	res.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		service: "remit-backend-local",
	});
});

// The scrape endpoint (standalone-observability D2), on the port this server
// already serves on and never routed through Caddy — deploy/vps/caddy/routes.caddy
// proxies /api/*, /content/* and /health, and everything else goes to the static
// web server, so there is no path from the public origin to this route.
//
// The per-account sync age is a database read, so it is collected when a scrape
// arrives rather than tracked as syncs complete. A read that fails fails the
// scrape: a signal that could not be evaluated must not render as a healthy
// number. Only the self-host backends have a store to read here — the
// AWS-local dev path composes its client from outside this module.
if (isSelfHostBackend) {
	onScrape(async () => {
		const client = await getClient();
		setAccountSyncAges(await collectAccountSyncAges(client, Date.now()));
	});
}

app.get("/metrics", async (_req: Request, res: Response) => {
	const body = await renderMetrics().catch((error: unknown) => {
		logger.error({ error: String(error) }, "Metrics collection failed");
		return null;
	});
	if (body === null) {
		res.status(500).type("text/plain").send("metrics collection failed\n");
		return;
	}
	res.setHeader("content-type", metricsContentType).send(body);
});

// Swagger UI exposes the full API schema, so it must never be on the public
// surface. On the self-host backends this server is the deployed backend
// container; gate the docs to the AWS-local dev path only. The generated
// OpenAPI document is still consumed programmatically by the APISIX edge via its
// own mounted paths — this only removes the browsable UI from the deployed
// surface.
//
// Dynamic import, not a static one: swagger-ui-express uses `__dirname` to
// locate its bundled assets on disk, which esbuild only shims (not
// eliminates) for an unconditional top-level import — that shim plus this
// file's own top-level `await import("@remit/auth-service")` above
// makes the bundle's module format ambiguous to Node
// (`ERR_AMBIGUOUS_MODULE_SYNTAX`), crashing every backend container start,
// including the ones that never take this branch. A dynamic import here
// keeps swagger-ui-express (and its `__dirname` shim) out of module scope
// entirely unless this is the AWS-local dev path.
if (!isSelfHostBackend) {
	const swaggerUi = await import("swagger-ui-express");
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

	// On the self-host stack this route is the deployed content-delivery surface;
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

	const client = await getClient();
	const result = await serveContent(
		{
			// ENOENT means the body isn't synced yet (→ 202); any other read error
			// throws so express 500s it — never masked as a missing body.
			readObject: async (path) =>
				readFile(path).catch((error: unknown) => {
					if (isStorageNotFoundError(error)) return null;
					throw error;
				}),
			lookupMessage: async (messageId) => {
				// A gone message row means nothing to re-arm — still answer 202.
				const message = await client.message.get(messageId).catch(() => null);
				return message
					? { mailboxId: message.mailboxId, uid: message.uid }
					: null;
			},
			requestBodySync: async (input) => {
				await client.bodySyncQueue?.requestBodySync(input);
			},
		},
		{ fullPath, storageKey },
	);

	res.status(result.status);
	for (const [name, value] of Object.entries(result.headers)) {
		res.setHeader(name, value);
	}
	res.send(result.body);
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
			logger.error("Failed to parse JSON body");
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

// This file is the backend image's entrypoint, so its startup output is the
// first thing a log collector reads from the container. It goes through the
// logger for the same reason every other line does: one JSON object per line is
// the contract in deploy/vps/README.md, and a banner printed alongside it is a
// line the pipeline cannot parse.
//
// This is also the everyday `npm run dev` server, so the addresses stay whole
// and clickable — `url`, not a port a developer has to assemble one themselves.
app.listen(Number(port), "0.0.0.0", () => {
	// biome-ignore lint/plugin/no-logger-info: the configuration a container came up on is an audit-grade signal
	logger.info(
		{
			port: Number(port),
			url: `http://localhost:${port}`,
			dataBackend: process.env.DATA_BACKEND,
			nodeEnv: env.NODE_ENV,
			...(isSelfHostBackend
				? {}
				: { apiDocsUrl: `http://localhost:${port}/api-docs` }),
		},
		"Backend listening",
	);

	process.send?.("ready");
});

export default app;
