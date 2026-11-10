#!/usr/bin/env node
// The TypeSpec emitters write their package.json without `sideEffects`, so a
// bundler keeps every generated module it reaches; this stamps the field on
// each package directory given.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const dir of process.argv.slice(2)) {
	const manifestPath = join(dir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.sideEffects = false;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
