import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import { buildRelationalDeletionCapabilities } from "./compose-relational.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

const exists = (path: string): Promise<boolean> =>
	stat(path)
		.then(() => true)
		.catch(() => false);

const writeUnder = async (base: string, key: string): Promise<string> => {
	const full = join(base, key);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, "x");
	return full;
};

describe("relational deletion capabilities — filesystem storage cleanup", () => {
	let base: string;
	const prevStoragePath = process.env.STORAGE_LOCAL_PATH;

	beforeEach(async () => {
		base = await mkdtemp(join(tmpdir(), "remit-relational-storage-"));
		process.env.STORAGE_LOCAL_PATH = base;
	});

	afterEach(() => {
		if (prevStoragePath === undefined) delete process.env.STORAGE_LOCAL_PATH;
		else process.env.STORAGE_LOCAL_PATH = prevStoragePath;
	});

	it("removes every object under the account prefix, leaving siblings intact", async () => {
		const caps = buildRelationalDeletionCapabilities();

		const deleted = [
			await writeUnder(base, "accounts/cfg-1/acc-1/messages/m1/body.eml"),
			await writeUnder(base, "accounts/cfg-1/acc-2/messages/m2/parts/1"),
		];
		const kept = await writeUnder(
			base,
			"accounts/cfg-2/acc-9/messages/m9/body.eml",
		);

		await caps.deleteStoragePrefix("accounts/cfg-1/", noopLog);

		for (const path of deleted) {
			assert.equal(await exists(path), false, `${path} must be deleted`);
		}
		assert.equal(await exists(kept), true, "a different tenant must survive");
	});

	it("scopes deletion to a single account when the prefix names one", async () => {
		const caps = buildRelationalDeletionCapabilities();

		const deleted = await writeUnder(
			base,
			"accounts/cfg-1/acc-1/messages/m1/body.eml",
		);
		const keptSibling = await writeUnder(
			base,
			"accounts/cfg-1/acc-2/messages/m2/body.eml",
		);

		await caps.deleteStoragePrefix("accounts/cfg-1/acc-1/", noopLog);

		assert.equal(await exists(deleted), false);
		assert.equal(
			await exists(keptSibling),
			true,
			"a sibling account under the same tenant must survive",
		);
	});

	it("is replay-safe — deleting a missing prefix does not throw", async () => {
		const caps = buildRelationalDeletionCapabilities();
		await caps.deleteStoragePrefix("accounts/never-existed/", noopLog);
	});
});

describe("relational deletion capabilities — CDN and sign-out are no-ops", () => {
	it("invalidateContent resolves without a CDN", async () => {
		const caps = buildRelationalDeletionCapabilities();
		await caps.invalidateContent("cfg-1", noopLog);
		await caps.invalidateContent("cfg-1/acc-1", noopLog);
	});

	it("signOut resolves without a federated session store", async () => {
		const caps = buildRelationalDeletionCapabilities();
		await caps.signOut("user-123", noopLog);
	});
});
