import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_PACKAGES } from "./generated-packages.mjs";

// The TypeSpec-generated packages (dir/name mapping shared with
// check-consumer-typecheck.mjs via lib/generated-packages.mjs), in dependency
// order (all are leaves), plus the built web client as a data package.
// `peerDependencies` names the runtime libraries the built output imports but
// expects the consumer to supply — merged onto whatever the emitter declared so
// a standalone install resolves them.
const generatedPeerDependencies = {
	"@remit/api-zod-schemas": { zod: "^3.0.0" },
	"@remit/electrodb-entities": { electrodb: ">=3.0.0" },
	"@remit/api-http-client": { "@tanstack/react-query": "^5.0.0" },
};

export const GENERATED_PUBLISHABLE = [
	...GENERATED_PACKAGES.map(({ dir, name }) => ({
		dir,
		name,
		peerDependencies: generatedPeerDependencies[name] ?? {},
	})),
	// The built web client as a static-asset data package: index.html, the
	// hashed asset bundle, locales, and the default runtime config.js
	// (better-auth self-host). A deployment installs it and replaces config.js
	// with its own values instead of building the client from source. `build`
	// runs the vite build (which empties dist/) before the manifest is
	// synthesized into it, so packing sees a fresh tree.
	{
		dir: "packages/web-client/dist",
		name: "@remit/web-client-dist",
		peerDependencies: {},
		build: ["npm", ["run", "build", "-w", "@remit/web-client"]],
		manifest: {
			name: "@remit/web-client-dist",
			version: "0.0.0",
			description:
				"Built Remit web client — static assets and the default runtime config.",
			files: ["**/*"],
		},
	},
];

const readManifest = (repoRoot, dir) =>
	JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));

// Publishable workspace packages: everything under packages/ not marked private.
export const workspacePackages = (repoRoot) => {
	const out = [];
	for (const name of readdirSync(join(repoRoot, "packages"))) {
		const dir = join("packages", name);
		let manifest;
		try {
			manifest = readManifest(repoRoot, dir);
		} catch {
			continue;
		}
		if (manifest.private) continue;
		out.push({ dir, name: manifest.name, kind: "workspace" });
	}
	return out;
};

export const publishablePackages = (repoRoot) => [
	...GENERATED_PUBLISHABLE,
	...workspacePackages(repoRoot),
];
