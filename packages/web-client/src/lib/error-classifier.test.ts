import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "./api";
import {
	getErrorStatus,
	hasHttpStatus,
	isAbortError,
	isClientBug,
	isNetworkError,
	isServerError,
	shouldEscalate,
} from "./error-classifier";
import { NetworkError, taggedFetch } from "./network-error";

const timeoutError = (): Error => {
	const error = new Error("The operation timed out.");
	error.name = "TimeoutError";
	return error;
};

const abortError = (): Error => {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
};

describe("getErrorStatus", () => {
	it("reads status off an ApiError", () => {
		assert.equal(getErrorStatus(new ApiError("boom", 503)), 503);
	});

	it("reads a numeric status off a plain object", () => {
		assert.equal(getErrorStatus({ status: 500 }), 500);
		assert.equal(getErrorStatus({ statusCode: 404 }), 404);
	});

	it("returns undefined when no status is present", () => {
		assert.equal(getErrorStatus(new Error("network")), undefined);
		assert.equal(getErrorStatus("nope"), undefined);
		assert.equal(getErrorStatus(null), undefined);
	});
});

describe("isServerError", () => {
	it("is true for any 5xx", () => {
		assert.equal(isServerError(new ApiError("boom", 500)), true);
		assert.equal(isServerError(new ApiError("boom", 502)), true);
		assert.equal(isServerError({ status: 599 }), true);
	});

	it("is false for a 4xx", () => {
		assert.equal(isServerError(new ApiError("not found", 404)), false);
		assert.equal(isServerError(new ApiError("forbidden", 403)), false);
	});

	it("is false for a statusless error", () => {
		assert.equal(isServerError(new TypeError("Failed to fetch")), false);
		assert.equal(isServerError(undefined), false);
	});
});

describe("hasHttpStatus", () => {
	it("is true when the error carries a status", () => {
		assert.equal(hasHttpStatus(new ApiError("boom", 500)), true);
		assert.equal(hasHttpStatus({ statusCode: 404 }), true);
	});

	it("is false for a statusless error", () => {
		assert.equal(hasHttpStatus(new TypeError("Failed to fetch")), false);
		assert.equal(hasHttpStatus(null), false);
	});
});

describe("isAbortError", () => {
	it("is true for an AbortError", () => {
		assert.equal(isAbortError(abortError()), true);
	});

	it("is false for anything else", () => {
		assert.equal(isAbortError(new ApiError("boom", 500)), false);
		assert.equal(isAbortError(new TypeError("Failed to fetch")), false);
	});
});

describe("isNetworkError", () => {
	// The boundary tags the failure, so the browser's wording never matters.
	// These are the real rejections `fetch` produces, across engines — every one
	// of them has to stay soft, whatever it happens to say.
	const transportFailures = [
		new TypeError("Failed to fetch"), // Chrome, Edge
		new TypeError("NetworkError when attempting to fetch resource."), // Firefox
		new TypeError("Load failed"), // WebKit
		new TypeError("The network connection was lost."), // WebKit, wifi dropped
		new TypeError("The request timed out."), // WebKit
		new TypeError("fetch failed"), // undici
		new Error("something no engine has said yet"),
	];

	it("is true for anything the fetch boundary tagged, whatever it says", () => {
		for (const failure of transportFailures) {
			assert.equal(
				isNetworkError(new NetworkError(failure)),
				true,
				`"${failure.message}" must stay soft`,
			);
		}
	});

	it("is true for a timeout — a timeout is a transport failure", () => {
		assert.equal(isNetworkError(new NetworkError(timeoutError())), true);
	});

	it("is false for an aborted request (its own category)", () => {
		assert.equal(isNetworkError(abortError()), false);
	});

	it("is false when the error carries a status", () => {
		assert.equal(isNetworkError(new ApiError("boom", 500)), false);
		assert.equal(isNetworkError(new ApiError("not found", 404)), false);
	});

	it("is false for an exception thrown by our own code", () => {
		assert.equal(
			isNetworkError(
				new TypeError('can\'t access property "map", x is undefined'),
			),
			false,
		);
	});

	it("does not mistake an untagged error for transport just because it reads like one", () => {
		// A bug whose message happens to contain a fetch-failure phrase is still a
		// bug. Only the boundary gets to say otherwise.
		assert.equal(isNetworkError(new TypeError("Failed to fetch")), false);
	});
});

describe("taggedFetch — where the decision is actually made", () => {
	const withFetch = async (
		impl: typeof fetch,
		run: () => Promise<void>,
	): Promise<void> => {
		const original = globalThis.fetch;
		globalThis.fetch = impl;
		try {
			await run();
		} finally {
			globalThis.fetch = original;
		}
	};

	it("tags every transport rejection, regardless of its message", async () => {
		for (const message of [
			"Failed to fetch",
			"The network connection was lost.",
			"fetch failed",
			"anything at all",
		]) {
			await withFetch(
				() => Promise.reject(new TypeError(message)),
				async () => {
					const error = await taggedFetch("/x").catch((e: unknown) => e);
					assert.ok(error instanceof NetworkError);
					assert.equal(isNetworkError(error), true);
					assert.equal(shouldEscalate(error), false);
				},
			);
		}
	});

	it("tags a timeout, because a timeout never reached a server", async () => {
		await withFetch(
			() => Promise.reject(timeoutError()),
			async () => {
				const error = await taggedFetch("/x").catch((e: unknown) => e);
				assert.ok(error instanceof NetworkError);
				assert.equal(shouldEscalate(error), false);
			},
		);
	});

	it("leaves a deliberate abort untagged — it is not a failure", async () => {
		await withFetch(
			() => Promise.reject(abortError()),
			async () => {
				const error = await taggedFetch("/x").catch((e: unknown) => e);
				assert.ok(!(error instanceof NetworkError));
				assert.equal(isAbortError(error), true);
			},
		);
	});

	it("passes a response through untouched, including an error status", async () => {
		const response = new Response("nope", { status: 500 });
		await withFetch(
			() => Promise.resolve(response),
			async () => {
				assert.equal(await taggedFetch("/x"), response);
			},
		);
	});
});

describe("isClientBug", () => {
	it("is true for an exception raised inside our own code", () => {
		assert.equal(
			isClientBug(
				new TypeError('can\'t access property "map", x is undefined'),
			),
			true,
		);
	});

	it("is false for a request that reached, or failed to reach, a server", () => {
		assert.equal(isClientBug(new ApiError("boom", 500)), false);
		assert.equal(isClientBug(new ApiError("not found", 404)), false);
		assert.equal(
			isClientBug(new NetworkError(new TypeError("Failed to fetch"))),
			false,
		);
		assert.equal(isClientBug(abortError()), false);
	});
});

describe("shouldEscalate (the fail-fast decision table — #1059)", () => {
	it("escalates a 5xx by default", () => {
		assert.equal(shouldEscalate(new ApiError("boom", 500)), true);
		assert.equal(shouldEscalate(new ApiError("boom", 503)), true);
	});

	it("escalates a 5xx EVEN when the call site marked it soft (rule 2 wins)", () => {
		assert.equal(
			shouldEscalate(new ApiError("boom", 500), { softError: true }),
			true,
		);
	});

	it("escalates a 4xx by DEFAULT (no opt-out)", () => {
		assert.equal(shouldEscalate(new ApiError("not found", 404)), true);
		assert.equal(shouldEscalate(new ApiError("forbidden", 403)), true);
	});

	it("does NOT escalate a 4xx the call site opted out of via meta.softError", () => {
		assert.equal(
			shouldEscalate(new ApiError("not found", 404), { softError: true }),
			false,
		);
	});

	it("does NOT escalate an aborted/cancelled request", () => {
		assert.equal(shouldEscalate(abortError()), false);
	});

	it("does NOT escalate a network/offline blip", () => {
		assert.equal(
			shouldEscalate(new NetworkError(new TypeError("Failed to fetch"))),
			false,
		);
		assert.equal(
			shouldEscalate(
				new NetworkError(new TypeError("The network connection was lost.")),
			),
			false,
		);
	});

	it("a network error is soft regardless of meta", () => {
		assert.equal(
			shouldEscalate(new NetworkError(new TypeError("Failed to fetch")), {
				softError: false,
			}),
			false,
		);
	});

	it("escalates an exception thrown by our own code, softError or not", () => {
		const bug = new TypeError('can\'t access property "map", x is undefined');
		assert.equal(shouldEscalate(bug), true);
		assert.equal(shouldEscalate(bug, { softError: true }), true);
	});
});
