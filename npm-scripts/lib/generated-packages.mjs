// The @remit/* packages TypeSpec codegen writes into gitignored build/ output.
// `typespec/tspconfig.yaml`'s per-emitter `emitter-output-dir`/`package-name`
// options are the source of this dir -> package-name mapping; root
// `package.json` pins each as `file:build/<dir>`, which is how a workspace
// package's plain `"*"` dependency on one of these names actually resolves
// locally (npm hoists the `file:` target into root `node_modules`). None of
// this is a registry artifact — it exists only after `npm run codegen` (or
// `make`) has run in this tree.
export const GENERATED_PACKAGES = [
	{ dir: "build/ts-enums", name: "@remit/domain-enums" },
	{ dir: "build/openapi-types", name: "@remit/api-openapi-types" },
	{ dir: "build/zod-schemas", name: "@remit/api-zod-schemas" },
	{ dir: "build/ddb-entities", name: "@remit/electrodb-entities" },
	{ dir: "build/remit-client", name: "@remit/api-http-client" },
	{ dir: "build/drizzle-entities", name: "@remit/drizzle-pg-schema" },
	{
		dir: "build/drizzle-entities-sqlite",
		name: "@remit/drizzle-sqlite-schema",
	},
];
