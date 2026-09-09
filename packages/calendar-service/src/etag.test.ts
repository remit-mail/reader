import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEtag } from "./etag.js";
import { singleEvent } from "./fixtures.js";
import { parseCalendar, serializeCalendar } from "./parse.js";

const RESOURCE = singleEvent(
	"DTSTART:20260826T090000Z",
	"DTEND:20260826T100000Z",
	"SUMMARY:Quarterly review",
	"X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
);

const reserialize = async (icalData: string): Promise<string> => {
	const parsed = await parseCalendar(icalData);
	assert.ok(parsed.ok);
	return serializeCalendar(parsed.value.component);
};

describe("computeEtag", () => {
	it("is a bare sha256 hex digest, unquoted", () => {
		assert.match(computeEtag(RESOURCE), /^[0-9a-f]{64}$/);
	});

	it("is stable across a parse and serialize", async () => {
		const once = await reserialize(RESOURCE);

		assert.equal(computeEtag(await reserialize(once)), computeEtag(once));
	});

	it("moves when the event changes", () => {
		assert.notEqual(
			computeEtag(RESOURCE),
			computeEtag(
				singleEvent(
					"DTSTART:20260826T090000Z",
					"DTEND:20260826T110000Z",
					"SUMMARY:Quarterly review",
					"X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
				),
			),
		);
	});

	it("hashes the stored bytes, so line endings are never normalized away", () => {
		// Two resources that differ only in line endings are two different
		// resources: the store keeps what it was given, and a tag computed over a
		// normalized copy would report them as the same bytes.
		assert.notEqual(
			computeEtag(RESOURCE),
			computeEtag(RESOURCE.replace(/\r\n/g, "\n")),
		);
	});
});
