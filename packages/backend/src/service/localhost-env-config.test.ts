import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const parseEnvFile = (relativePath: string): Record<string, string> => {
	const contents = readFileSync(`${repoRoot}${relativePath}`, "utf8");
	const entries: Record<string, string> = {};
	for (const line of contents.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		entries[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
	}
	return entries;
};

describe("local dev SQS routing (localhost-dev-aws.env)", {
	// localhost-dev-aws.env is AWS-local-dev config, stripped from the open-core
	// tree; skip where it is absent.
	skip: !existsSync(`${repoRoot}localhost-dev-aws.env`),
}, () => {
	const env = parseEnvFile("localhost-dev-aws.env");

	it("publishes backend writes to the FIFO mailboxes queue the sync consumer drains", () => {
		// Prod wires the API's SQS_QUEUE_URL to the mailboxes FIFO queue
		// (infra remit-api-stack.ts). Onboarding publishes SYNC_MAILBOXES there;
		// the imap worker consumes it. Local dev must mirror that or onboarding
		// events land in a queue nothing drains and accounts never sync.
		assert.equal(env.SQS_QUEUE_URL, env.SQS_QUEUE_URL_MAILBOXES);
		assert.ok(env.SQS_QUEUE_URL?.endsWith(".fifo"));
	});
});
