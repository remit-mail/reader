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
import { FilterPipeline } from "./pipeline.js";

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

const senders = (actionMailboxId: string) =>
	store.filter.create({
		accountConfigId: ACCOUNT,
		name: "rule",
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.Or,
		literalClauses: [
			{ field: FilterClauseField.From, value: "npm@github.com" },
			{ field: FilterClauseField.From, value: "notifications@github.com" },
		],
		actionMailboxId,
	});

const pipeline = () =>
	new FilterPipeline(
		{
			filterService: store.filter,
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
		},
		{ info: () => {}, error: () => {} },
	);

describe("FilterPipeline over literal filters", () => {
	it("resolves the move for a matching sender", async () => {
		const filter = await senders(archive);

		const decision = await pipeline().evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			fromGithub,
		);

		assert.deepEqual(decision.move, {
			destinationMailboxId: archive,
			filterId: filter.filterId,
		});
	});

	it("resolves nothing for a sender no clause names", async () => {
		await senders(archive);

		const decision = await pipeline().evaluate(
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

		const decision = await pipeline().evaluate(
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

		const mine = await pipeline().evaluate(
			ACCOUNT,
			account.accountId,
			"m-1",
			fromGithub,
		);
		const theirs = await pipeline().evaluate(
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

		const decision = await pipeline().evaluate(
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
