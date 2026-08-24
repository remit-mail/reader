import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMissingPackage, isMissingVersion } from "./registry-errors.mjs";

const execFailure = (stderr) =>
	Object.assign(new Error("Command failed: npm pack"), { stdout: "", stderr });

const ETARGET = [
	"npm error code ETARGET",
	"npm error notarget No matching version found for @remit/ui@0.0.145.",
	"",
].join("\n");

const E404 = [
	"npm error code E404",
	"npm error 404 '@remit/ui@latest' is not in this registry.",
	"",
].join("\n");

describe("isMissingVersion", () => {
	it("reads the version a publish has not propagated yet", () => {
		assert.equal(isMissingVersion(execFailure(ETARGET)), true);
	});

	it("reads a package that is not on the registry at all", () => {
		assert.equal(isMissingVersion(execFailure(E404)), true);
	});

	it("keeps an unrelated npm failure a failure", () => {
		assert.equal(
			isMissingVersion(execFailure("npm error code EAI_AGAIN\n")),
			false,
		);
	});
});

describe("isMissingPackage", () => {
	it("reads a package that is not on the registry", () => {
		assert.equal(isMissingPackage(execFailure(E404)), true);
	});

	it("does not read an unfetchable version as an absent package", () => {
		assert.equal(isMissingPackage(execFailure(ETARGET)), false);
	});

	it("reads the code out of a message-only error", () => {
		assert.equal(isMissingPackage(new Error("npm error 404 Not Found")), true);
	});
});
