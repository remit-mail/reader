import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AppGraph,
	AUTH_COMPOSITIONS,
	bundleAppGraph,
} from "@/test-support/bundle-app";

/**
 * Proves the auth shell is a composition choice, not a runtime toggle inside
 * one bundle: a build that composes the better-auth provider contains no
 * Amplify/Cognito code, and one that composes the Cognito provider does. The
 * app shell and screens are walked from the real entry each time, so this fails
 * the moment any surface reaches back to a specific identity SDK.
 */
const mentionsAmplify = ({ inputs, importPaths }: AppGraph): boolean =>
	[...inputs, ...importPaths].some((path) => /aws-amplify/.test(path));

const composesCognitoShell = ({ inputs }: AppGraph): boolean =>
	inputs.some(
		(path) =>
			path.includes("auth/cognito/") || path.includes("cognito-provider"),
	);

describe("web-client composition", () => {
	it("omits every Amplify/Cognito module when composing the better-auth provider", async () => {
		const graph = await bundleAppGraph(AUTH_COMPOSITIONS.betterAuth);

		assert.ok(
			graph.inputs.some((path) => path.includes("shell/index")),
			"the app shell should be walked from the entry",
		);
		assert.equal(
			mentionsAmplify(graph),
			false,
			"a better-auth build must not reference aws-amplify anywhere in its graph",
		);
		assert.equal(
			composesCognitoShell(graph),
			false,
			"a better-auth build must not pull the Cognito shell",
		);
	});

	it("includes the Amplify/Cognito modules when composing the cognito provider", async () => {
		const graph = await bundleAppGraph(AUTH_COMPOSITIONS.cognito);

		assert.equal(
			mentionsAmplify(graph),
			true,
			"a cognito build must reference aws-amplify",
		);
		assert.equal(
			composesCognitoShell(graph),
			true,
			"a cognito build must pull the Cognito shell",
		);
	});
});
