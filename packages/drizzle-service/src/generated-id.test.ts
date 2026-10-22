import assert from "node:assert/strict";
import { test } from "node:test";
import { generateBase36Id } from "@remit/drizzle-sqlite-schema";
import shortUuid from "short-uuid";

const base36 = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);

test("the schema's id default writes the 25-char base36 v4 uuid that short-uuid reads and writes back unchanged", () => {
	for (let i = 0; i < 5000; i += 1) {
		const id = generateBase36Id();
		assert.match(id, /^[0-9a-z]{25}$/);
		const uuid = base36.toUUID(id);
		assert.match(
			uuid,
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		assert.equal(base36.fromUUID(uuid), id);
	}
});
