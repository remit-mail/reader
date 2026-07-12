// esbuild's ".sql" -> "text" loader (npm-scripts/docker-bundle.mjs) turns a
// `.sql` import into a plain string at bundle time; this just tells
// TypeScript the same thing so run-migrate.ts type-checks outside the bundler.
declare module "*.sql" {
	const content: string;
	export default content;
}
