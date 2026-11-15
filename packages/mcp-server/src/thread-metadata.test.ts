import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	AuthResultVerdict,
	ClassificationLabel,
	MessageCategory,
	MessageClassificationState,
	PlacementAction,
	PlacementConfidence,
	SpamAction,
	SpamJudgeName,
	SpamKind,
	SpamModelOutcome,
	SpamReasonName,
} from "@remit/domain-enums";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
	spamConfigFor,
} from "@remit/mailbox-service/test-helpers/test-store";
import { MCP_READ_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { createMcpHandler } from "./server.js";
import { ruleDeps } from "./test-rule-deps.js";

const USER_ID = "mcp-metadata-user";
const THREAD_ID = "thread-across-two-folders";
const JUNKED_THREAD_ID = "thread-junked-by-remit";
const PAGE = 50;

type Row = {
	messageId: string;
	mailboxId: string;
	classification: {
		classificationState: string;
		category: string;
		scores: { label: string; confidence: number; confident: boolean }[];
	};
	auth:
		| { state: "NotParsed" }
		| { state: "Parsed"; dmarc?: string; spf?: string; dkim?: string };
	autoMoved?: unknown;
	placementVerdict?: { reasons: string[] };
	spamVerdict: unknown;
};

let store: Store;
let deps: McpDeps;
let account: AccountItem;
let inbox: MailboxItem;
let archive: MailboxItem;
let junk: MailboxItem;
const scored = new Set<string>();

const callToolJson = async (
	name: string,
	args: Record<string, unknown>,
): Promise<{ items: Row[] }> => {
	const handler = createMcpHandler(
		{ userId: USER_ID, scopes: [MCP_READ_SCOPE] },
		deps,
	);
	const response = await handler(
		new Request("http://reader.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name, arguments: args },
			}),
		}),
	);
	const body = await response.json();
	return JSON.parse(body.result.content[0].text);
};

before(async () => {
	store = await openStore();
	const storage = store.storage();
	deps = {
		...store,
		storage,
		bodySync: new BodySyncService(
			store.message,
			storage,
			store.threadMessage,
			store.address,
			store.envelope,
			new SyncWarningService(store.syncWarning),
			spamConfigFor(store),
			silentLog,
		),
		bodySyncQueue: { requestBodySync: async () => {} },
		logger: silentLog,
		...ruleDeps(store, recordingQueue()),
	};
	account = await seedAccount(store, {
		accountConfigId: deriveAccountConfigId(USER_ID),
	});
	inbox = await seedMailbox(store, account, "INBOX");
	archive = await seedMailbox(store, account, "Archive");
	junk = await seedMailbox(store, account, "Junk");
	await seedMessage(store, account, junk, PAGE + 1, {
		message: {
			movedByRemit: true,
			placementVerdict: {
				action: PlacementAction.MoveToJunk,
				confidence: PlacementConfidence.Confident,
				fromPlacement: "inbox",
				reasons: ["dmarc-fail"],
				dryRun: false,
				decidedAt: 1_700_000_000_000,
			},
			spamVerdict: {
				state: "Checked",
				score: 0.95,
				action: SpamAction.Junk,
				kind: SpamKind.Spam,
				reasons: [
					{
						name: SpamReasonName.DmarcFail,
						symbol: "DMARC_POLICY_REJECT",
						score: 0.95,
						options: [],
					},
				],
				modelOutcome: SpamModelOutcome.NotConfigured,
				decidedBy: SpamJudgeName.Inline,
			},
		},
		threadMessage: { threadId: JUNKED_THREAD_ID },
	});

	for (let uid = 1; uid <= PAGE; uid += 1) {
		const withMetadata = uid % 2 === 0;
		const { message } = await seedMessage(
			store,
			account,
			uid <= PAGE / 2 ? inbox : archive,
			uid,
			{
				message: withMetadata
					? {
							category: MessageCategory.coldOutreach,
							classificationState: MessageClassificationState.Examined,
							classifierScores: [
								{
									label: ClassificationLabel.ColdOutreach,
									confidence: 0.9,
									confident: true,
								},
							],
							authResult: {
								dmarc: AuthResultVerdict.Pass,
								spf: AuthResultVerdict.Softfail,
							},
						}
					: {},
				threadMessage: { threadId: THREAD_ID },
			},
		);
		if (withMetadata) scored.add(message.messageId);
	}
});

after(async () => {
	await store.close();
});

describe("classification and auth on the thread tools", () => {
	it("carries both objects on every message of a page across two folders", async () => {
		const page = await callToolJson("get_thread", {
			threadId: THREAD_ID,
			limit: PAGE,
		});

		assert.equal(page.items.length, PAGE);
		assert.deepEqual(
			new Set(page.items.map((row) => row.mailboxId)),
			new Set([inbox.mailboxId, archive.mailboxId]),
		);
		for (const row of page.items) {
			if (scored.has(row.messageId)) {
				assert.deepEqual(row.classification, {
					classificationState: "Examined",
					category: "coldOutreach",
					scores: [{ label: "ColdOutreach", confidence: 0.9, confident: true }],
				});
				assert.deepEqual(row.auth, {
					state: "Parsed",
					dmarc: "Pass",
					spf: "Softfail",
				});
				continue;
			}
			assert.deepEqual(row.classification, {
				classificationState: "NotExamined",
				category: "uncategorized",
				scores: [],
			});
			assert.deepEqual(row.auth, { state: "NotParsed" });
		}
	});

	it("carries them on list_threads", async () => {
		const page = await callToolJson("list_threads", {
			mailboxId: archive.mailboxId,
		});

		assert.equal(page.items.length, PAGE / 2);
		for (const row of page.items) {
			assert.ok(row.auth);
		}
	});
});

describe("placement on get_thread", () => {
	it("says why Remit junked a message", async () => {
		const page = await callToolJson("get_thread", {
			threadId: JUNKED_THREAD_ID,
		});

		assert.equal(page.items.length, 1);
		const [row] = page.items;
		assert.equal(row?.mailboxId, junk.mailboxId);
		assert.deepEqual(row?.autoMoved, {
			action: "MoveToJunk",
			fromPlacement: "inbox",
		});
		assert.deepEqual(row?.placementVerdict?.reasons, ["dmarc-fail"]);
		assert.deepEqual(row?.spamVerdict, {
			state: "Checked",
			score: 0.95,
			action: "Junk",
			kind: "Spam",
			reasons: [
				{
					name: "DmarcFail",
					symbol: "DMARC_POLICY_REJECT",
					score: 0.95,
					options: [],
				},
			],
			modelOutcome: "NotConfigured",
			decidedBy: "Inline",
		});
	});
});
