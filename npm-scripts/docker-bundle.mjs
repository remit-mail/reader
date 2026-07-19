#!/usr/bin/env node
// Bundles every service entrypoint for the container images (RFC 035 D2).
//
// One esbuild bundle per service — the same recipe the Lambda path already
// proves (infra/constructs/lambda/nodejs-arm-function): ESM, minified, a
// banner that restores CommonJS `require` inside the ESM bundle (esbuild's
// ESM output otherwise throws `Dynamic require of "<mod>" is not supported`
// whenever a bundled CJS dependency calls `require(...)` at runtime).
//
// Native/model-loading dependencies stay external — they are installed into
// the runtime image from a minimal per-service package.json instead of being
// bundled. Bundling per entrypoint (rather than `npm ci --omit=dev` of the
// whole workspace) is what keeps a worker image from dragging in dependencies
// it never touches through barrel imports — the lesson from the Lambda path,
// where barrel imports pulled `pg` and NLP libraries into DynamoDB functions.
import { existsSync } from "node:fs";
import { build } from "esbuild";

const CJS_REQUIRE_BANNER =
	"import{createRequire as __remitCreateRequire}from 'module';const require=__remitCreateRequire(import.meta.url);";

// esbuild's CJS-to-ESM interop shims every bundled CJS module's own
// `__dirname`/`__filename` references so path-based lookups (pino locating
// its worker-thread scripts, historically swagger-ui-express locating its
// static assets) keep working post-bundle. A shimmed `__dirname` and this
// entry's own genuine top-level `await` (every poller entrypoint's
// `await runQueuePoller(...)`, the backend's conditional
// `await import("@remit/auth-service")`) together make Node's module
// loader unable to decide the bundle's format
// (`ERR_AMBIGUOUS_MODULE_SYNTAX: Cannot determine intended module format
// because both '__dirname' and top-level await are present`), crashing
// every one of these containers at startup — not a hypothetical, this
// failed on every worker plus backend when first run in the vps compose
// stack. Defining `__dirname`/`__filename` in terms of `import.meta` here
// pre-empts esbuild's own shim (no bare `__dirname` identifier is left for
// it to inject), which is also the fix Node's own error message points at:
// "If the code is intended to be an ES module, use import.meta.dirname
// instead."
const DIRNAME_DEFINES = {
	__dirname: "import.meta.dirname",
	__filename: "import.meta.filename",
};

// pg is a pure-JS driver but probes for the optional native `pg-native`
// add-on via a runtime require esbuild can't resolve statically; keep it
// external everywhere it's used and install it in the runtime stage instead.
const PG = "pg";

// better-sqlite3 is a native module (a `.node` binding it locates relative to
// its own install tree). It is reached only on the DATA_BACKEND=sqlite branch
// (RFC 036), through a dynamic `import()` inside @remit/drizzle-service —
// so every service that builds a data client can reach it. Keep it external and
// install it in the runtime stage of the sqlite images: inlining the driver's
// JS would still leave its `.node` require unresolvable next to the bundle.
const SQLITE = "better-sqlite3";

// The embedding model path. remit-search-index-worker is the process that
// actually calls buildEmbeddingServiceFromEnv()/pgvector when
// DATA_BACKEND=postgres (see packages/search-index-worker/src/services.ts).
// remit-pg-index-worker is a Postgres LISTEN/NOTIFY -> SQS relay with no
// embedding of its own (packages/remit-pg-index-worker/src/worker.ts) — despite
// what RFC 035's D2/FAQ says, the model belongs in the search-index-worker
// image, not pg-index-worker. Stated here, and in the PR description, as a
// deliberate correction rather than a silent fix.
//
// better-sqlite3/sqlite-vec back the LOCAL_VECTORDB_PATH vector store, reached
// only through `runtimeImport` (a dynamic `import(variable)` esbuild cannot see,
// by design — see remit-search-service/src/backends/runtime-import.ts). Because
// runtimeImport is invisible to esbuild they are never bundled; they are
// installed into the runtime image instead. On DATA_BACKEND=sqlite (RFC 036)
// this is the live vector path: search-index-worker WRITES embeddings, so its
// runtime image (docker/runtime/search-index-worker/package.json) pins
// `sqlite-vec`. That image is the glibc node:24-slim base — sqlite-vec ships a
// glibc-only loadable extension (`vec0.so`), which would not dlopen on the
// Alpine/musl backend image anyway.
//
// The backend image serves no semantic-search READS on either compose profile:
// answering a query means embedding it in-process, and @huggingface/transformers
// plus the model are deliberately absent from that image (they would roughly
// quadruple it and park the model's ~300 MiB in the API container). The
// /search/semantic endpoint capability-gates to empty results instead of
// erroring — see remit-backend/src/service/semantic-capability.ts and
// deploy/vps/README.md; FTS/trigram text search covers the primary search
// contract on both profiles.
const SEARCH_NATIVE = ["@huggingface/transformers"];

/** @type {Array<{name: string, entry: string, outfile?: string, external?: string[], loader?: Record<string, string>}>} */
export const TARGETS = [
	{
		name: "backend",
		entry: "packages/backend/dev-server/server.ts",
		external: [PG, SQLITE],
	},
	{
		name: "imap-worker",
		entry: "packages/imap-worker/src/poller.ts",
		external: [PG, SQLITE],
	},
	{
		name: "smtp-worker",
		entry: "packages/smtp-worker/src/poller.ts",
		external: [PG, SQLITE],
	},
	{
		name: "account-worker",
		entry: "packages/account-worker/src/poller.ts",
		external: [PG, SQLITE],
	},
	{
		name: "search-index-worker",
		entry: "packages/search-index-worker/src/poller.ts",
		external: [PG, SQLITE, ...SEARCH_NATIVE],
	},
	{
		name: "pg-index-worker",
		entry: "packages/remit-pg-index-worker/src/run-worker.ts",
		external: [PG],
	},
	// Ships inside the backend image (dist-docker/backend/migrate.mjs) as an
	// alternate entrypoint — "the backend image with a migrate command"
	// (RFC 035 D8) — not a ninth image. The compose `migrate` one-shot
	// service overrides CMD to run this instead of server.mjs.
	{
		name: "backend-migrate",
		entry: "deploy/vps/migrate/run-migrate.ts",
		outfile: "dist-docker/backend/migrate.mjs",
		// better-sqlite3 is a native module reached only on the
		// DATA_BACKEND=sqlite branch (RFC 036 D5), via a dynamic import esbuild
		// leaves unresolved; keep it external and install it in the runtime
		// stage, the same treatment pg gets.
		external: [PG, SQLITE],
		loader: { ".sql": "text" },
	},
];

async function main() {
	const only = process.argv[2];
	// Only bundle targets whose entrypoint ships in this tree. The open-core
	// export strips the Postgres-only pg-index-worker package, so its target
	// drops out automatically here instead of failing on the missing entry —
	// the exported roster matches the reader's compose without editing this file.
	const present = TARGETS.filter((t) => existsSync(t.entry));
	const targets = only
		? present.filter((t) => t.name === only)
		: present;
	if (targets.length === 0) {
		throw new Error(
			only
				? `docker-bundle: no present target named "${only}"`
				: "docker-bundle: no target entrypoints present in this tree",
		);
	}

	for (const target of targets) {
		const outfile = target.outfile ?? `dist-docker/${target.name}/server.mjs`;
		console.log(`docker-bundle: ${target.entry} -> ${outfile}`);
		await build({
			entryPoints: [target.entry],
			outfile,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node22",
			minify: true,
			sourcemap: false,
			banner: { js: CJS_REQUIRE_BANNER },
			define: DIRNAME_DEFINES,
			external: target.external ?? [],
			loader: target.loader ?? {},
			logLevel: "warning",
		});
	}
}

await main();
