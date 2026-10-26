import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";

const LAMBDA_ONLY =
	/node_modules\/(@aws-sdk|@smithy|aws-lambda|expect-env|prom-client|better-sqlite3|drizzle-orm)\/|(^|\/)(sqs-client|logger-lambda|drizzle-service)\/src\//;

// imapflow, nodemailer, mailparser and pino still reach these through
// nodejs_compat; the set is pinned so a new one is a deliberate change.
const ALLOWED_BUILTINS = [
	"assert",
	"buffer",
	"events",
	"fs",
	"module",
	"net",
	"node:buffer",
	"node:child_process",
	"node:crypto",
	"node:diagnostics_channel",
	"node:dns",
	"node:events",
	"node:fs",
	"node:http",
	"node:https",
	"node:net",
	"node:os",
	"node:path",
	"node:stream",
	"node:string_decoder",
	"node:tls",
	"node:url",
	"node:util",
	"node:zlib",
	"path",
	"stream",
	"string_decoder",
	"url",
	"util",
	"worker_threads",
];

const bundle = async (): Promise<Metafile> => {
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
	return result.metafile;
};

describe("the @remit/imap-worker/process entry", () => {
	it("bundles without the AWS SDK, SQS, Lambda, env or SQLite modules", async () => {
		const metafile = await bundle();

		const reached = Object.keys(metafile.inputs).filter((path) =>
			LAMBDA_ONLY.test(path),
		);

		assert.deepEqual(reached, []);
	});

	it("reaches no Node built-in beyond the pinned set", async () => {
		const metafile = await bundle();

		const builtins = new Set(
			Object.values(metafile.outputs).flatMap((output) =>
				output.imports
					.filter((imported) => imported.external)
					.map((imported) => imported.path),
			),
		);

		assert.deepEqual([...builtins].sort(), ALLOWED_BUILTINS);
	});
});
