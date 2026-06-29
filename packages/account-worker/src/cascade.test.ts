import assert from "node:assert";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import {
	type CascadeServices,
	COVERED_ENTITY_TYPES,
	enumerateAccountPurgeMessageIds,
} from "./cascade.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

describe("cascade entity coverage snapshot", () => {
	it("covers every entity model in remit-electrodb-service", () => {
		const modelsDir = resolve(
			import.meta.dirname,
			"../../remit-electrodb-service/src/models",
		);
		const modelFiles = readdirSync(modelsDir)
			.filter(
				(f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
			)
			.map((f) => f.replace(".ts", ""));

		// Map model file names to the entity types they contain
		const entityTypesByFile: Record<string, string[]> = {
			"account-config": ["AccountConfig"],
			"account-export-request": [],
			"account-setting": ["AccountSetting"],
			"account-setting-registry": [],
			account: ["Account"],
			address: ["Address", "EnvelopeAddress"],
			envelope: [
				"Envelope",
				"MessageReference",
				"BodyPart",
				"BodyPartParameter",
				"RawMessageStorage",
				"BodyPartStorage",
				"BodyPartContent",
			],
			mailbox: ["Mailbox"],
			"mailbox-lock": ["MailboxLock"],
			"mailbox-special-use": [],
			message: ["Message"],
			"message-flag": ["MessageFlag"],
			"outbox-message": ["OutboxMessage"],
			"thread-message": ["ThreadMessage"],
			"wellknown-rule": [],
		};

		const allEntityTypes = Object.values(entityTypesByFile).flat().sort();
		const coveredSorted = [...COVERED_ENTITY_TYPES].sort();

		assert.deepStrictEqual(
			coveredSorted,
			allEntityTypes,
			`Cascade does not cover all entity types.\n` +
				`Missing: ${allEntityTypes.filter((t) => !(coveredSorted as readonly string[]).includes(t)).join(", ")}\n` +
				`Extra: ${(coveredSorted as readonly string[]).filter((t) => !allEntityTypes.includes(t)).join(", ")}`,
		);

		// Verify all model files are accounted for
		const unmappedFiles = modelFiles.filter((f) => !(f in entityTypesByFile));
		assert.deepStrictEqual(
			unmappedFiles,
			[],
			`Model files not mapped to entity types: ${unmappedFiles.join(", ")}`,
		);
	});
});

describe("enumerateAccountPurgeMessageIds — cheap fanout enumeration", () => {
	const PAGE_SIZE = 1000;
	const TOTAL_MESSAGES = 8762;

	const buildLargeAccountServices = (): {
		services: Pick<CascadeServices, "accountService" | "messageService">;
		describeCalls: { messageId: string }[];
		listByMailboxCalls: { mailboxId: string; cursor?: string }[];
	} => {
		const describeCalls: { messageId: string }[] = [];
		const listByMailboxCalls: { mailboxId: string; cursor?: string }[] = [];

		const allMessageIds = Array.from(
			{ length: TOTAL_MESSAGES },
			(_, i) => `msg-${i}`,
		);

		const accountService = {
			describe: async (accountId: string) => ({
				account: [{ accountId }],
				mailbox: [{ mailboxId: "mbox-1" }],
			}),
		};

		const messageService = {
			// A per-message describe is exactly what timed out the fanout; if the
			// enumeration calls it, the test fails loudly.
			describe: async (messageId: string) => {
				describeCalls.push({ messageId });
				throw new Error("describe() must not be called by the fanout");
			},
			listByMailbox: async (
				mailboxId: string,
				options?: { continuationToken?: string },
			) => {
				const cursor = options?.continuationToken;
				listByMailboxCalls.push({ mailboxId, cursor });
				const start = cursor ? Number.parseInt(cursor, 10) : 0;
				const slice = allMessageIds.slice(start, start + PAGE_SIZE);
				const next = start + PAGE_SIZE;
				return {
					items: slice.map((messageId) => ({ messageId })),
					continuationToken:
						next < allMessageIds.length ? String(next) : undefined,
				};
			},
		};

		return {
			services: {
				accountService,
				messageService,
			} as unknown as Pick<
				CascadeServices,
				"accountService" | "messageService"
			>,
			describeCalls,
			listByMailboxCalls,
		};
	};

	it("enumerates an 8,762-message account via paginated list queries with no per-message describe", async () => {
		const { services, describeCalls, listByMailboxCalls } =
			buildLargeAccountServices();

		const result = await enumerateAccountPurgeMessageIds(
			"acct-1",
			services,
			noopLog,
		);

		assert.equal(
			result.messageIds.length,
			TOTAL_MESSAGES,
			"every message id is enumerated",
		);
		assert.deepEqual(result.mailboxIds, ["mbox-1"]);
		assert.equal(
			describeCalls.length,
			0,
			"the fanout must never call messageService.describe()",
		);
		assert.equal(
			listByMailboxCalls.length,
			Math.ceil(TOTAL_MESSAGES / PAGE_SIZE),
			"enumeration walks the mailbox in paginated list queries",
		);
	});
});
