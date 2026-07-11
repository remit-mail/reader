import assert from "node:assert";
import { mock, test } from "node:test";

test("extractDocText delegates to WordExtractor#extract and returns the body", async () => {
	mock.module("word-extractor", {
		defaultExport: class {
			async extract(input: Buffer) {
				assert.ok(Buffer.isBuffer(input));
				return { getBody: () => "mocked legacy .doc body" };
			}
		},
	});

	const { extractDocText } = await import("./doc.js");
	const text = await extractDocText(Buffer.from("legacy doc bytes"));

	assert.strictEqual(text, "mocked legacy .doc body");
});
