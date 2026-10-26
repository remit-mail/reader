import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const LAMBDA_ONLY = [
	/(^|\/)aws-lambda(\/|$)/,
	/(^|\/)@aws-sdk\//,
	/(^|\/)expect-env(\/|$)/,
	/(^|\/)sqs-client(\/|$)/,
	/(^|\/)logger-lambda(\/|$)/,
	/(^|\/)prom-client(\/|$)/,
];

const ENV_READERS: readonly string[] = [
	// The organize path reaches body sync through the mailbox-service barrel,
	// and body sync reads DEFER_BODY_PARTS itself. A new reader fails here.
	"../mailbox-service/src/body-sync.ts",
];

const packageDir = fileURLToPath(new URL("..", import.meta.url));

const bundleInputs = async () => {
	const { metafile } = await build({
		absWorkingDir: packageDir,
		entryPoints: ["src/process.ts"],
		bundle: true,
		write: false,
		metafile: true,
		platform: "node",
		format: "esm",
		logLevel: "silent",
	});
	return metafile.inputs;
};

describe("the ./process entry", () => {
	it("bundles without the Lambda runtime, the AWS SDK, SQS, expect-env or the Node metrics server", async () => {
		const reached = Object.entries(await bundleInputs()).flatMap(
			([path, input]) => [path, ...input.imports.map((entry) => entry.path)],
		);

		assert.deepEqual(
			reached.filter((path) =>
				LAMBDA_ONLY.some((pattern) => pattern.test(path)),
			),
			[],
		);
	});

	it("reaches no workspace source that reads process.env", async () => {
		const sources = Object.keys(await bundleInputs()).filter(
			(path) => !path.startsWith("<") && !path.includes("node_modules/"),
		);

		assert.deepEqual(
			sources.filter((path) =>
				/\bprocess\.env\b/.test(
					readFileSync(new URL(path, `file://${packageDir}`), "utf8"),
				),
			),
			ENV_READERS,
		);
	});
});
