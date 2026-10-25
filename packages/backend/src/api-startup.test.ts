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
