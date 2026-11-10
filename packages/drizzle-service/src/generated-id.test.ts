import assert from "node:assert/strict";
import { test } from "node:test";
import { base36FromUUID } from "@remit/data-ports/id";
import { generateBase36Id } from "@remit/drizzle-sqlite-schema";

const toUUID = (id: string): string =>
	[...id]
		.reduce((n, c) => n * 36n + BigInt(Number.parseInt(c, 36)), 0n)
		.toString(16)
		.padStart(32, "0")
		.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

test("a fixed uuid encodes to the same 25-char base36 id short-uuid's uuid25Base36 produced", () => {
	assert.equal(
		base36FromUUID("f47ac10b-58cc-4372-a567-0e02b2c3d479"),
		"eh20m2rvgvw6snhr754ezwsqh",
	);
	assert.equal(
		base36FromUUID("00000000-0000-4000-8000-000000000001"),
		"0000000001d7tmz9j2abdrls1",
	);
});

test("the schema's id default writes the 25-char base36 v4 uuid that reads and writes back unchanged", () => {
	for (let i = 0; i < 5000; i += 1) {
		const id = generateBase36Id();
		assert.match(id, /^[0-9a-z]{25}$/);
		const uuid = toUUID(id);
		assert.match(
			uuid,
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		assert.equal(base36FromUUID(uuid), id);
	}
});
