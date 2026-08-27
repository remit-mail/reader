import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { serializeConfigJsonSchema } from "../json-schema.js";
import { committedSchemaPath } from "../schema-artifact.js";

const target = committedSchemaPath();

if (!existsSync(target)) {
	console.error(`Config JSON Schema is missing: ${target}`);
	console.error("Run `npm run schema:emit -w @remit/config-format`.");
	process.exit(1);
}

if ((await readFile(target, "utf8")) === serializeConfigJsonSchema()) {
	console.log(`config JSON Schema is current: ${target}`);
	process.exit(0);
}

console.error(`Config JSON Schema is stale: ${target}`);
console.error("Run `npm run schema:emit -w @remit/config-format`.");
process.exit(1);
