import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isMissingPackage,
	isMissingVersion,
	withVersionPropagation,
} from "./registry-fetch.mjs";

// `execFileSync` reports the command's own output twice: appended to the message
// and on `stderr`.
const execFailure = (output) =>
	Object.assign(new Error(`Command failed: npm pack\n${output}`), {
		stdout: "",
		stderr: output,
	});

const ETARGET = execFailure(
	"npm error code ETARGET\nnpm error notarget No matching version found for @remit/ui@0.0.145.\n",
);

const E404 = execFailure(
	"npm error code E404\nnpm error 404 '@remit/ui@latest' is not in this registry.\n",
);

const OFFLINE = execFailure("npm error code EAI_AGAIN\nnpm error network\n");

describe("isMissingVersion", () => {
	it("reads the version a publish has not propagated yet", () => {
		assert.equal(isMissingVersion(ETARGET), true);
	});

	it("does not read an absent package as one", () => {
		assert.equal(isMissingVersion(E404), false);
	});

	it("does not read a network failure as one", () => {
		assert.equal(isMissingVersion(OFFLINE), false);
	});
});

describe("isMissingPackage", () => {
	it("reads a package that is not on the registry", () => {
		assert.equal(isMissingPackage(E404), true);
	});

	it("does not read an unfetchable version as an absent package", () => {
		assert.equal(isMissingPackage(ETARGET), false);
	});

	it("reads the code out of a message-only error", () => {
		assert.equal(isMissingPackage(new Error("npm error 404 Not Found")), true);
	});
});

describe("withVersionPropagation", () => {
	const recorder = () => {
		const waited = [];
		return { waited, sleep: (ms) => waited.push(ms) };
	};

	it("waits for a version the replica has not caught up with", () => {
		const { waited, sleep } = recorder();
		let attempts = 0;
		const result = withVersionPropagation(
			() => {
				attempts += 1;
				if (attempts < 3) throw ETARGET;
				return "packed";
			},
			{ delays: [1, 2, 4], sleep },
		);

		assert.equal(result, "packed");
		assert.equal(attempts, 3);
		assert.deepEqual(waited, [1, 2]);
	});

	it("fails on a version that stays unfetchable", () => {
		const { waited, sleep } = recorder();
		let attempts = 0;

		assert.throws(
			() =>
				withVersionPropagation(
					() => {
						attempts += 1;
						throw ETARGET;
					},
					{ delays: [1, 2], sleep },
				),
			/ETARGET/,
			"an unpublished version must end the run, not pass as a bump",
		);
		assert.equal(attempts, 3);
		assert.deepEqual(waited, [1, 2]);
	});

	it("raises anything that is not the propagation window at once", () => {
		const { waited, sleep } = recorder();
		let attempts = 0;

		assert.throws(
			() =>
				withVersionPropagation(
					() => {
						attempts += 1;
						throw OFFLINE;
					},
					{ delays: [1, 2], sleep },
				),
			/EAI_AGAIN/,
		);
		assert.equal(attempts, 1);
		assert.deepEqual(waited, []);
	});

	it("does not wait when the first pack answers", () => {
		const { waited, sleep } = recorder();
		assert.equal(
			withVersionPropagation(() => "packed", { delays: [1], sleep }),
			"packed",
		);
		assert.deepEqual(waited, []);
	});
});
