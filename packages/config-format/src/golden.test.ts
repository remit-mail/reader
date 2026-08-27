import assert from "node:assert/strict";
import { test } from "node:test";
import { readGoldenConfigDocument } from "./fixtures.js";
import { readConfigDocument } from "./read.js";
import { CURRENT_SCHEMA_VERSION } from "./version.js";

test("the golden v1 document parses", () => {
	const document = readConfigDocument(readGoldenConfigDocument());

	assert.equal(document.schemaVersion, CURRENT_SCHEMA_VERSION);
	assert.equal(document.accounts.length, 2);
	assert.deepEqual(
		document.accounts.map((account) => account.credentials.required),
		["password", "oauth"],
	);
});

test("the golden v1 document round-trips through JSON unchanged", () => {
	const source = readGoldenConfigDocument();

	const parsed = readConfigDocument(source);

	assert.deepEqual(JSON.parse(JSON.stringify(parsed)), source);
});

test("the golden v1 document carries the parts a move has to preserve", () => {
	const document = readConfigDocument(readGoldenConfigDocument());
	const [primary] = document.accounts;
	assert.ok(primary);

	assert.deepEqual(
		primary.folderRoles.find((role) => role.role === "Sent"),
		{ role: "Sent", folderPath: "INBOX.Sent" },
	);
	assert.deepEqual(primary.pinnedFolders, ["INBOX", "INBOX.Facturen"]);
	assert.equal(
		primary.folderOverrides[0]?.muted?.reason,
		"high volume, read on demand",
	);
	assert.equal(document.filters[0]?.actionFolder?.folderPath, "INBOX.Facturen");
	assert.equal(document.filters[0]?.actionLabelName, "Facturen");
	assert.ok(document.filters[1]?.anchor?.sourceText);
	assert.equal(document.addressFlags[0]?.flags.vip?.reason, "payment alerts");
	assert.equal(
		document.addressFlags[1]?.flags.unsubscribed?.expiresAt,
		1790000000000,
	);
});
