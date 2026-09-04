import assert from "node:assert/strict";
import { test } from "node:test";
import { noopLogger } from "./noop-logger.js";

test("the noop logger swallows every level and stays itself", () => {
	noopLogger.trace("trace");
	noopLogger.debug("debug");
	noopLogger.info("info");
	noopLogger.warn("warn");
	noopLogger.error("error");
	noopLogger.fatal("fatal");
	noopLogger.setBindings({ accountId: "acc-1" });

	assert.equal(noopLogger.child({ accountId: "acc-1" }), noopLogger);
});
