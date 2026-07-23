import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { StorageService } from "@remit/storage-service";
import type { CascadeServices } from "../cascade.js";
import type { AccountExportEvent } from "../events.js";
import {
	type ProcessAccountExportDeps,
	processAccountExport,
} from "./account-export.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

interface Update {
	state: string;
	objectKey?: string;
	expiresAt?: number;
	errorMessage?: string;
}

const bodyOf = (text: string): Readable => Readable.from([Buffer.from(text)]);

const buildDeps = (
	updates: Update[],
	overrides: {
		retrieveMessageBodyStream?: StorageService["retrieveMessageBodyStream"];
		storeExportArchiveStream?: StorageService["storeExportArchiveStream"];
	} = {},
): ProcessAccountExportDeps => ({
	services: {
		accountExportRequestService: {
			get: async () => ({ accountExportRequestId: "exp-1" }),
			update: async (_id: string, patch: Update) => {
				updates.push(patch);
			},
		},
		accountConfigService: {
			describe: async () => ({ account: [{ accountId: "acc-1" }] }),
		},
		accountService: {
			describe: async () => ({
				mailbox: [{ mailboxId: "mbx-1", fullPath: "INBOX" }],
			}),
		},
		messageService: {
			listAllByMailbox: async () => [
				{ messageId: "msg-1" },
				{ messageId: "msg-2" },
			],
		},
	} as unknown as CascadeServices,
	storageService: {
		retrieveMessageBodyStream:
			overrides.retrieveMessageBodyStream ??
			(async (_cfg: string, _acc: string, messageId: string) =>
				messageId === "msg-2" ? null : bodyOf("raw-eml")),
		storeExportArchiveStream:
			overrides.storeExportArchiveStream ??
			(async (_cfg: string, _req: string, stream: NodeJS.ReadableStream) => {
				await new Promise<void>((resolve) => {
					stream.on("data", () => {});
					stream.on("end", resolve);
				});
				return "exports/exp-1.zip";
			}),
	} as unknown as StorageService,
});

const event: AccountExportEvent = {
	type: "AccountExport",
	accountConfigId: "cfg-1",
	accountExportRequestId: "exp-1",
};

describe("processAccountExport", () => {
	it("drives the request Processing then Ready and stores the archive key", async () => {
		const updates: Update[] = [];
		await processAccountExport(event, noopLog, buildDeps(updates));

		assert.deepEqual(
			updates.map((u) => u.state),
			["Processing", "Ready"],
		);
		const ready = updates[1];
		assert.equal(ready?.objectKey, "exports/exp-1.zip");
		assert.ok(
			ready?.expiresAt && ready.expiresAt > Date.now(),
			"expiresAt is set in the future",
		);
	});

	it("skips messages that have no raw body without failing the export", async () => {
		const updates: Update[] = [];
		let retrieved = 0;
		await processAccountExport(
			event,
			noopLog,
			buildDeps(updates, {
				retrieveMessageBodyStream: async (
					_cfg: string,
					_acc: string,
					messageId: string,
				) => {
					retrieved += 1;
					return messageId === "msg-2" ? null : bodyOf("raw");
				},
			}),
		);

		assert.equal(retrieved, 2, "both messages were consulted");
		assert.equal(updates.at(-1)?.state, "Ready");
	});

	it("marks the request Failed and rethrows when storage upload rejects", async () => {
		const updates: Update[] = [];
		await assert.rejects(
			processAccountExport(
				event,
				noopLog,
				buildDeps(updates, {
					storeExportArchiveStream: async (
						_cfg: string,
						_req: string,
						stream: NodeJS.ReadableStream,
					) => {
						await new Promise<void>((resolve) => {
							stream.on("data", () => {});
							stream.on("end", resolve);
						});
						throw new Error("s3 down");
					},
				}),
			),
			/s3 down/,
		);

		const failed = updates.at(-1);
		assert.equal(failed?.state, "Failed");
		assert.equal(failed?.errorMessage, "s3 down");
	});
});
