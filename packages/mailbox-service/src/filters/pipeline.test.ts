import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
	type AccountItem,
	type CreateFilterInput,
	type FilterItem,
	filterRuleFromClauses,
} from "@remit/data-ports";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	AccountAuthType,
	ConnectionState,
	FilterClauseField,
	FilterDisabledReason,
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import { getDomain } from "tldts";
import { PlacementMoveService } from "../placement-move.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
} from "../test-helpers/test-store.js";
import { type FilterMessage, NO_ACTION } from "./match.js";
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
		rule: filterRuleFromClauses({
			matchOperator: FilterMatchOperator.Or,
			literalClauses: [
				{ field: FilterClauseField.From, value: "npm@github.com" },
				{ field: FilterClauseField.From, value: "notifications@github.com" },
			],
		}),
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
				queue: recordingQueue(),
			}),
		},
		{ info: () => {}, error: () => {} },
	);

const evaluate = async (accountId: string, msg: FilterMessage) => {
	const filters = pipeline();
	const active = await store.filter.listByAccountAndState(
		ACCOUNT,
		FilterState.Active,
	);
	return filters.decide(await filters.prepare(ACCOUNT, accountId, active), msg);
};

describe("FilterPipeline over literal filters", () => {
	it("resolves the move for a matching sender", async () => {
		const filter = await senders(archive);

		const decision = await evaluate(account.accountId, fromGithub);

		assert.deepEqual(decision.move, {
			destinationMailboxId: archive,
			filterId: filter.filterId,
		});
	});

	it("resolves nothing for a sender no clause names", async () => {
		await senders(archive);

		const decision = await evaluate(account.accountId, {
			...fromGithub,
			from: "hello@stripe.com",
		});

		assert.equal(decision.move, undefined);
		assert.deepEqual(decision.labels, []);
	});

	it("gives a contested message to the more recently changed action", async () => {
		mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
		await senders(archive);
		mock.timers.setTime(9_000_000);
		const rival = await senders(projects);

		const decision = await evaluate(account.accountId, fromGithub);

		assert.deepEqual(decision.move, {
			destinationMailboxId: projects,
			filterId: rival.filterId,
		});
	});
});

describe("FilterPipeline over a filter with no rules", () => {
	it("resolves nothing, so the filter does not file every message", async () => {
		await store.filter.create({
			accountConfigId: ACCOUNT,
			name: "Notifications npm",
			scope: FilterScope.Standing,
			rule: filterRuleFromClauses({
				matchOperator: FilterMatchOperator.And,
				literalClauses: [],
			}),
			actionMailboxId: archive,
		});

		assert.deepEqual(await evaluate(account.accountId, fromGithub), {
			labels: [],
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

		const mine = await evaluate(account.accountId, fromGithub);
		const theirs = await evaluate(sibling.accountId, fromGithub);

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

		const decision = await evaluate(account.accountId, fromGithub);

		assert.deepEqual(decision, { labels: [] });
		const stored = await store.filter.get(ACCOUNT, filter.filterId);
		assert.equal(stored.state, "Disabled");
		assert.equal(stored.disabledReason, "FolderMissing");
	});
});

describe("FilterPipeline.decide by priority and stop", () => {
	const github = filterRuleFromClauses({
		matchOperator: FilterMatchOperator.And,
		literalClauses: [{ field: FilterClauseField.From, value: "github.com" }],
	});

	const filter = (
		filterId: string,
		over: Partial<FilterItem> = {},
	): FilterItem => ({
		filterId,
		accountConfigId: ACCOUNT,
		name: filterId,
		scope: FilterScope.Standing,
		state: FilterState.Active,
		disabledReason: FilterDisabledReason.None,
		ruleChangedAt: 1,
		actionChangedAt: 1,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [],
		rule: github,
		priority: 0,
		stop: false,
		actionLabelId: NO_ACTION,
		actionMailboxId: NO_ACTION,
		createdAt: 1,
		updatedAt: 1,
		...over,
	});

	const decide = async (filters: FilterItem[]) =>
		pipeline().decide({ filters, getDomain }, fromGithub);

	it("gives the move to the lower priority before the newer action", async () => {
		const decision = await decide([
			filter("newer", { actionChangedAt: 9, actionMailboxId: projects }),
			filter("first", { priority: -1, actionMailboxId: archive }),
		]);

		assert.deepEqual(decision.move, {
			destinationMailboxId: archive,
			filterId: "first",
		});
	});

	it("keeps labels adding up while the first move wins", async () => {
		const decision = await decide([
			filter("a", { actionLabelId: "lbl-a", actionMailboxId: archive }),
			filter("b", {
				priority: 1,
				actionLabelId: "lbl-b",
				actionMailboxId: projects,
			}),
		]);

		assert.deepEqual(decision, {
			labels: [
				{ labelId: "lbl-a", filterId: "a" },
				{ labelId: "lbl-b", filterId: "b" },
			],
			move: { destinationMailboxId: archive, filterId: "a" },
		});
	});

	it("stops after a matching filter's own label, before a later move", async () => {
		const decision = await decide([
			filter("label", { actionLabelId: "lbl-a", stop: true }),
			filter("move", { priority: 1, actionMailboxId: projects }),
		]);

		assert.deepEqual(decision, {
			labels: [{ labelId: "lbl-a", filterId: "label" }],
		});
	});

	it("does not stop on a filter that did not match", async () => {
		const decision = await decide([
			filter("other", {
				stop: true,
				actionLabelId: "lbl-a",
				rule: filterRuleFromClauses({
					matchOperator: FilterMatchOperator.And,
					literalClauses: [
						{ field: FilterClauseField.From, value: "stripe.com" },
					],
				}),
			}),
			filter("move", { priority: 1, actionMailboxId: projects }),
		]);

		assert.deepEqual(decision, {
			labels: [],
			move: { destinationMailboxId: projects, filterId: "move" },
		});
	});
});
