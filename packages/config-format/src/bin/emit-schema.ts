import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serializeConfigJsonSchema } from "../json-schema.js";
import { artifactSchemaPath, committedSchemaPath } from "../schema-artifact.js";

const serialized = serializeConfigJsonSchema();

for (const target of [committedSchemaPath(), artifactSchemaPath()]) {
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, serialized, "utf8");
	console.log(`wrote ${target}`);
}
