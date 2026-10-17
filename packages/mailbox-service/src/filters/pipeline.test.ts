import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { AccountItem, CreateFilterInput } from "@remit/data-ports";
import {
	AccountAuthType,
	ConnectionState,
	FilterClauseField,
	FilterMatchOperator,
	FilterScope,
} from "@remit/domain-enums";
import { PlacementMoveService } from "../placement-move.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
} from "../test-helpers/test-store.js";
import type { FilterMessage } from "./match.js";
import { type FilterConfig, FilterPipeline } from "./pipeline.js";

const ACCOUNT = "cfg-1";

let store: Store;
let account: AccountItem;
let archive: string;
let projects: string;

beforeEach(async () => {
	store = await openStore();
	account = await seedAccount(store, { accountConfigId: ACCOUNT });
	archive = (await seedMailbox(store, account, "Archive")).mailboxId;
	projects = (await seedMailbox(store, account, "Projects")).mailboxId;
});

afterEach(async () => {
	mock.timers.reset();
	await store.close();
});

const fromGithub: FilterMessage = {
	from: "npm@github.com",
	fromName: "npm",
	subject: "A new version of left-pad is available",
	text: "body",
	listId: "",
};

const receipt: FilterMessage = {
	from: "billing@stripe.com",
	fromName: "Stripe",
	subject: "Your receipt",
	text: "Thanks for your payment",
	listId: "",
};

const addFilter = (input: Partial<CreateFilterInput>) =>
	store.filter.create({
		accountConfigId: ACCOUNT,
		name: "rule",
		scope: FilterScope.Standing,
		...input,
	});

const senders = (actionMailboxId: string) =>
	addFilter({
		matchOperator: FilterMatchOperator.Or,
		literalClauses: [
			{ field: FilterClauseField.From, value: "npm@github.com" },
			{ field: FilterClauseField.From, value: "notifications@github.com" },
		],
		actionMailboxId,
	});

const anchored = async (anchorEmbeddingId: string) => {
	const filter = await addFilter({ hasAnchor: true, actionLabelId: "lbl-1" });
	await store.filterAnchor.put({
		accountConfigId: ACCOUNT,
		filterId: filter.filterId,
		anchorEmbedding: [0, 1, 0],
		anchorEmbeddingId,
		anchorSourceText: "your receipt is ready",
		anchorMessageId: "msg-anchor",
	});
	return filter;
};

const pipeline = (embedder: FilterConfig["embedder"]) =>
	new FilterPipeline(
		{
			filterService: store.filter,
			filterAnchorService: store.filterAnchor,
			messageLabelService: store.messageLabel,
			mailboxService: store.mailbox,
			placementMoveService: new PlacementMoveService({
				messageService: store.message,
				threadMessageService: store.threadMessage,
				markerService: store.placementMove,
				addressService: store.address,
				mailboxSpecialUseService: store.mailboxSpecialUse,
				mailboxService: store.mailbox,
				sqsQueueUrl: "https://sqs.test/message-mgmt",
			}),
			embedder,
		},
		{ info: () => {}, error: () => {} },
	);

const countingEmbedder = (vector: number[], embeddingId: string) => {
	const embedded: string[] = [];
	return {
		embedded,
		embedder: {
			embeddingId,
			embed: async (text: string) => {
				embedded.push(text);
				return vector;
			},
		},
	};
};

describe("FilterPipeline over literal filters", () => {
	it("resolves the move for a matching sender without embedding", async () => {
		const filter = await senders(archive);
		const { embedded, embedder } = countingEmbedder([], "m@0");

		const decision = await pipeline(embedder).evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			fromGithub,
		);

		assert.deepEqual(decision.move, {
			destinationMailboxId: archive,
			filterId: filter.filterId,
		});
		assert.deepEqual(embedded, []);
	});

	it("resolves nothing for a sender no clause names", async () => {
		await senders(archive);

		const decision = await pipeline(undefined).evaluate(
			ACCOUNT,
			account.accountId,
			"m-2",
			{
				...fromGithub,
				from: "hello@stripe.com",
			},
		);

		assert.equal(decision.move, undefined);
		assert.deepEqual(decision.labels, []);
	});

	it("gives a contested message to the more recently changed action", async () => {
		mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
		await senders(archive);
		mock.timers.setTime(9_000_000);
		const rival = await senders(projects);

		const decision = await pipeline(undefined).evaluate(
			ACCOUNT,
			account.accountId,
			"m-3",
			fromGithub,
		);

		assert.deepEqual(decision.move, {
			destinationMailboxId: projects,
			filterId: rival.filterId,
		});
	});
});

describe("FilterPipeline re-embeds an anchor on model drift", () => {
	it("re-embeds a stale anchor, stores it and matches on the same pass", async () => {
		const filter = await anchored("old-model@3");
		const { embedded, embedder } = countingEmbedder([1, 0, 0], "new-model@3");

		const decision = await pipeline(embedder).evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			receipt,
		);

		assert.deepEqual(decision.labels, [
			{ labelId: "lbl-1", filterId: filter.filterId },
		]);
		const anchor = await store.filterAnchor.get(ACCOUNT, filter.filterId);
		assert.equal(anchor?.anchorEmbeddingId, "new-model@3");
		assert.deepEqual(anchor?.anchorEmbedding, [1, 0, 0]);
		assert.equal(embedded.length, 2);
	});

	it("embeds only the message when the anchor is current", async () => {
		await anchored("current@3");
		const { embedded, embedder } = countingEmbedder([0, 1, 0], "current@3");

		await pipeline(embedder).evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			receipt,
		);

		assert.equal(embedded.length, 1);
	});

	it("skips only the filter whose re-embed failed", async () => {
		await anchored("old-model@3");
		const literal = await addFilter({
			literalClauses: [{ field: FilterClauseField.From, value: "stripe.com" }],
			actionLabelId: "lbl-literal",
		});

		const decision = await pipeline({
			embeddingId: "new-model@3",
			embed: async (text) => {
				if (text === "your receipt is ready") throw new Error("model down");
				return [1, 0, 0];
			},
		}).evaluate(ACCOUNT, account.accountId, "m-1", receipt);

		assert.deepEqual(decision.labels, [
			{ labelId: "lbl-literal", filterId: literal.filterId },
		]);
	});
});

describe("FilterPipeline scopes a filter to its folder's account", () => {
	it("leaves another account's mail alone, as if the filter had not matched", async () => {
		const sibling = await store.account.create({
			accountConfigId: ACCOUNT,
			username: "me-too@example.com",
			email: "me-too@example.com",
			authType: AccountAuthType.Password,
			passwordHash: '{"ciphertext":"x"}',
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});
		const travel = await seedMailbox(store, sibling, "Travel");
		const filter = await senders(travel.mailboxId);

		const mine = await pipeline(undefined).evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			fromGithub,
		);
		const theirs = await pipeline(undefined).evaluate(
			ACCOUNT,
			sibling.accountId,
			"m-2",
			fromGithub,
		);

		assert.deepEqual(mine, { labels: [] });
		assert.deepEqual(theirs.move, {
			destinationMailboxId: travel.mailboxId,
			filterId: filter.filterId,
		});
		assert.equal(
			(await store.filter.get(ACCOUNT, filter.filterId)).state,
			"Active",
		);
	});

	it("turns the filter off when no account holds its folder any more", async () => {
		const filter = await senders("mbx-gone");

		const decision = await pipeline(undefined).evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			fromGithub,
		);

		assert.deepEqual(decision, { labels: [] });
		const stored = await store.filter.get(ACCOUNT, filter.filterId);
		assert.equal(stored.state, "Disabled");
		assert.equal(stored.disabledReason, "FolderMissing");
	});
});
