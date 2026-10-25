import assert from "node:assert/strict";
import { it } from "node:test";

// A Cloudflare Worker under nodejs_compat has a `process` without `cpuUsage`.
// The Node logger's process metrics called it while the module graph loaded, so
// the Worker died before serving a request. Each test file runs in its own
// process, so removing it here cannot leak into another suite.
it("loads the api without Node's process metrics", async () => {
	Reflect.deleteProperty(process, "cpuUsage");

	await assert.doesNotReject(import("./api.js"));
});

// A Cloudflare Worker refuses `new Function`, which ajv compiles validators
// with, so every validated request answered 500 there. The query params still
// have to arrive coerced, because handlers forward `limit` as a number. The
// Worker calls init itself, which rebuilds the router validator.
it("validates and coerces a request without compiling code", async () => {
	const { api } = await import("./api.js");
	await api.init();
	const NativeFunction = globalThis.Function;
	globalThis.Function = new Proxy(NativeFunction, {
		construct: () => {
			throw new EvalError("Code generation from strings disallowed");
		},
	});

	try {
		const result = api.validateRequest(
			{
				method: "GET",
				path: "/threads",
				query: { limit: "5", unread: "true" },
				headers: {},
			},
			"UnifiedThreadOperations_listAllThreads",
		);

		assert.equal(result.valid, true);
		assert.deepEqual(result.coerced?.query, { limit: 5, unread: true });
	} finally {
		globalThis.Function = NativeFunction;
	}
});
