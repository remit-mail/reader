import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const LAMBDA_ONLY =
	/node_modules\/(@aws-sdk|@smithy|aws-lambda|expect-env|prom-client|better-sqlite3|drizzle-orm)\/|(^|\/)(sqs-client|logger-lambda|drizzle-service)\/src\//;

describe("the @remit/imap-worker/process entry", () => {
	it("bundles without the AWS SDK, SQS, Lambda, env or SQLite modules", async () => {
		const result = await build({
			entryPoints: [fileURLToPath(new URL("./process.ts", import.meta.url))],
			bundle: true,
			write: false,
			metafile: true,
			platform: "node",
			format: "esm",
			outdir: "unused",
			logLevel: "silent",
		});

		const reached = Object.keys(result.metafile.inputs).filter((path) =>
			LAMBDA_ONLY.test(path),
		);

		assert.deepEqual(reached, []);
	});
});
