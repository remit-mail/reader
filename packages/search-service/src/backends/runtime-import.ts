/**
 * Import a module by a specifier the bundler cannot see.
 *
 * `remit-search-service` is bundled into the production Lambdas (the API and the
 * search-index worker) with esbuild. The local-only backends below depend on
 * native / heavyweight packages (`better-sqlite3`, `sqlite-vec`,
 * `@huggingface/transformers`) that must never enter a production bundle —
 * esbuild cannot bundle a `.node` binary and would break the deploy.
 *
 * Passing the specifier through a variable defeats esbuild's static analysis, so
 * the import stays a real runtime `import()` that is resolved by Node only when
 * the local backend is actually constructed (i.e. under `npm start` / the
 * integration test, never in production where these env flags are unset).
 */
export const runtimeImport = async <T>(specifier: string): Promise<T> =>
	import(specifier) as Promise<T>;
