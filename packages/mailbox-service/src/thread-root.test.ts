import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { threadRootOf } from "./thread-root.js";

const headers = (inReplyTo = "") => ({
	messageId: "<self@example.com>",
	inReplyTo,
});

describe("threadRootOf", () => {
	it("reads a doubled References root in its wire spelling", () => {
		assert.equal(
			threadRootOf(headers("<p@example.com>"), ["<<root@example.com>>"], "m"),
			"<root@example.com>",
		);
	});

	it("falls back to a doubled In-Reply-To, then to the message itself", () => {
		assert.equal(
			threadRootOf(headers("<<p@example.com>>"), undefined, "m"),
			"<p@example.com>",
		);
		assert.equal(threadRootOf(headers(), undefined, "m"), "<self@example.com>");
		assert.equal(
			threadRootOf({ messageId: "<>", inReplyTo: "" }, [], "m"),
			"m",
		);
	});
});
