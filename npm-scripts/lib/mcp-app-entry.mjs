// What `@remit/mcp-server/app` may not reach: a host without Node (a
// Cloudflare Worker) composes it, apart from the VPS composition root (#1581).
export const FORBIDDEN_PACKAGES = [
	"@hono/node-server",
	"@remit/auth-service",
	"@remit/drizzle-service",
	"@remit/logger-lambda",
	"@remit/logger/node",
	"@remit/sqs-client",
	"@remit/storage-service/s3",
	"better-auth/node",
	"better-sqlite3",
];

export const ALLOWED = new Set([
	"@remit/auth-service/constants",
	"@remit/auth-service/verifier",
	"@remit/drizzle-service/schema-sets/mcp",
]);

export const isForbiddenPackage = (spec, packages = FORBIDDEN_PACKAGES) =>
	!ALLOWED.has(spec) &&
	packages.some((name) => spec === name || spec.startsWith(`${name}/`));
