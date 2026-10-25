import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
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
import { buildFilterConfig, type FilterConfigDeps } from "./filter-config.js";
import type { FilterMessage } from "./match.js";
import { FilterPipeline } from "./pipeline.js";

let store: Store;
let filterId: string;
let accountId: string;
let archiveId: string;

beforeEach(async () => {
	store = await openStore();
	const account = await seedAccount(store, { accountConfigId: "cfg-1" });
	accountId = account.accountId;
	const archive = await seedMailbox(store, account, "Archive");
	archiveId = archive.mailboxId;
	const filter = await store.filter.create({
		accountConfigId: "cfg-1",
		name: "receipts",
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.Or,
		literalClauses: [{ field: FilterClauseField.From, value: "stripe.com" }],
		actionMailboxId: archive.mailboxId,
	});
	filterId = filter.filterId;
});

afterEach(() => store.close());

const repos = (): FilterConfigDeps => ({
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
});

const message: FilterMessage = {
	from: "billing@stripe.com",
	fromName: "Stripe",
	subject: "Your receipt",
	text: "Thanks for your payment",
	listId: "",
};

describe("buildFilterConfig", () => {
	it("runs a literal filter on the body-sync pass", async () => {
		const config = buildFilterConfig(repos());

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", accountId, "m-1", message);

		assert.deepEqual(decision.move, {
			destinationMailboxId: archiveId,
			filterId,
		});
	});
});
