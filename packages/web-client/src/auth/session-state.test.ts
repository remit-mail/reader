import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySessionQuery } from "./session-state";

const rateLimited = {
	status: 429,
	statusText: "Too Many Requests",
	error: { message: "Too many requests. Please try again later." },
};

describe("classifySessionQuery", () => {
	it("is pending only while nothing has come back", () => {
		assert.deepEqual(
			classifySessionQuery({ data: null, isPending: true, error: null }),
			{ kind: "pending" },
		);
	});

	it("is active whenever a session is held", () => {
		assert.deepEqual(
			classifySessionQuery({
				data: { user: { id: "u1" } },
				isPending: false,
				error: null,
			}),
			{ kind: "active" },
		);
	});

	it("keeps a held session through a throttled refetch", () => {
		assert.deepEqual(
			classifySessionQuery({
				data: { user: { id: "u1" } },
				isPending: false,
				error: rateLimited,
			}),
			{ kind: "active" },
		);
	});

	it("reads a 429 as rate limited, never as signed out (#441)", () => {
		assert.deepEqual(
			classifySessionQuery({
				data: null,
				isPending: false,
				error: rateLimited,
			}),
			{ kind: "rateLimited" },
		);
	});

	it("is signed out only when the lookup answered without a session", () => {
		assert.deepEqual(
			classifySessionQuery({ data: null, isPending: false, error: null }),
			{ kind: "signedOut" },
		);
		assert.deepEqual(
			classifySessionQuery({
				data: null,
				isPending: false,
				error: { status: 401, statusText: "Unauthorized" },
			}),
			{ kind: "signedOut" },
		);
	});
});
