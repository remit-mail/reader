import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type {
	AddressResponse,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type {
	AddressItem,
	FlagsMergePatch,
	ResultList,
} from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	failingQueue,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type { HandlerContext } from "../types.js";
import { AddressDetailOperations, AddressOperations } from "./address.js";

let client: RemitClient;

const searchAddresses = (
	context: Context,
	caller: HandlerContext<QueueName>,
): Promise<ResultList<AddressItem>> =>
	AddressOperations.AddressOperations_searchAddresses(
		context,
		caller,
	) as Promise<ResultList<AddressItem>>;

const updateAddress = (
	context: Context,
	caller: HandlerContext<QueueName>,
): Promise<AddressResponse> =>
	AddressDetailOperations.AddressDetailOperations_updateAddress(
		context,
		caller,
	) as Promise<AddressResponse>;

const SUB = "cognito-sub-704";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);

const callerOf = (sub: string): HandlerContext<QueueName> => ({
	client,
	config: testApiConfig(),
	identity: {
		kind: "user",
		accountConfigId: deriveAccountConfigId(sub),
		sub,
		email: `${sub}@example.com`,
	},
});

const contextFor = (query: { q: string; limit?: number }): Context =>
	({ request: { query } }) as unknown as Context;

const address = (over: Partial<AddressItem>): AddressItem =>
	({
		addressId: "addr-1",
		accountConfigId: ACCOUNT_CONFIG_ID,
		localPart: "amsterdam",
		domain: "pocahondas.nl",
		normalizedEmail: "amsterdam@pocahondas.nl",
		normalizedCompound: "pocahondas locatie amsterdam amsterdam@pocahondas.nl",
		displayName: "Pocahondas locatie amsterdam",
		flags: {},
		inboundCount: 4,
		outboundCount: 1,
		replyCount: 2,
		lastInboundAt: 1_000,
		lastReplyAt: 900,
		createdAt: 100,
		updatedAt: 200,
		...over,
	}) as AddressItem;

interface Listing {
	accountConfigId: string;
	search?: string;
	limit?: number;
}

const clientReturning = (items: AddressItem[], seen: Listing[]): RemitClient =>
	({
		address: {
			listByAccountConfig: async (
				input: Listing,
			): Promise<ResultList<AddressItem>> => {
				seen.push(input);
				return { items, continuationToken: undefined };
			},
		},
	}) as unknown as RemitClient;

afterEach(() => {
	mock.restoreAll();
});

describe("AddressOperations_searchAddresses", () => {
	it("looks a partial term up against the caller's own addresses (#704)", async () => {
		const seen: Listing[] = [];
		client = clientReturning([address({})], seen);

		const response = await searchAddresses(
			contextFor({ q: "Po", limit: 8 }),
			callerOf(SUB),
		);

		assert.deepEqual(seen, [
			{ accountConfigId: ACCOUNT_CONFIG_ID, search: "po", limit: 8 },
		]);
		assert.deepEqual(
			response.items.map((item) => item.normalizedEmail),
			["amsterdam@pocahondas.nl"],
		);
		assert.equal(response.items[0].displayName, "Pocahondas locatie amsterdam");
	});

	it("hands the suggestion list back in the order it was ranked", async () => {
		const seen: Listing[] = [];
		client = clientReturning(
			[
				address({
					addressId: "addr-frequent",
					normalizedEmail: "zoe@pocahondas.nl",
				}),
				address({
					addressId: "addr-stranger",
					normalizedEmail: "aaron@pocahondas.nl",
					inboundCount: 0,
					replyCount: 0,
				}),
			],
			seen,
		);

		const response = await searchAddresses(
			contextFor({ q: "po" }),
			callerOf(SUB),
		);

		assert.deepEqual(
			response.items.map((item) => item.addressId),
			["addr-frequent", "addr-stranger"],
		);
	});

	it("asks for a suggestion-sized window when the caller names no limit", async () => {
		const seen: Listing[] = [];
		client = clientReturning([], seen);

		await searchAddresses(contextFor({ q: "po" }), callerOf(SUB));

		assert.equal(seen[0].limit, 10);
	});
});

const updateContextFor = (body: UpdateAddressInput): Context =>
	({
		request: { params: { addressId: "addr-1" }, requestBody: body },
	}) as unknown as Context;

/**
 * Fake data client that applies the same merge semantics the repo does:
 * a `null` in the patch deletes the key, anything else writes it.
 */
const clientHolding = (
	stored: AddressItem,
	seen: FlagsMergePatch[],
	accountFanout: RecordingQueue = recordingQueue(),
): RemitClient =>
	({
		queues: { accountFanout },
		address: {
			getAddress: async (): Promise<AddressItem> => stored,
			mergeFlags: async (
				_accountConfigId: string,
				_addressId: string,
				patch: FlagsMergePatch,
			): Promise<AddressItem> => {
				seen.push(patch);
				const flags: Record<string, unknown> = { ...(stored.flags ?? {}) };
				for (const [key, value] of Object.entries(patch)) {
					if (value === undefined) continue;
					if (value === null) delete flags[key];
					else flags[key] = value;
				}
				return { ...stored, flags } as AddressItem;
			},
		},
	}) as unknown as RemitClient;

/**
 * The never-spam grant (#605) travels the same route every other flag does. The
 * exclusivity against `blocked` is not asserted here: it lives in the repo's
 * merge fold, the only place that sees both keys at once.
 */
describe("AddressDetailOperations_updateAddress never-spam (#605)", () => {
	it("forwards the grant to the merge patch and hands it back on the address", async () => {
		const seen: FlagsMergePatch[] = [];
		client = clientHolding(address({ flags: {} }), seen);

		const response = await updateAddress(
			updateContextFor({ flags: { neverSpam: { value: true, setAt: 20 } } }),
			callerOf(SUB),
		);

		assert.deepEqual(seen, [{ neverSpam: { value: true, setAt: 20 } }]);
		assert.deepEqual(response.flags.neverSpam, { value: true, setAt: 20 });
	});

	it("clears the grant by naming the key, the removal form every flag shares", async () => {
		const seen: FlagsMergePatch[] = [];
		client = clientHolding(
			address({ flags: { neverSpam: { value: true, setAt: 10 } } }),
			seen,
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["neverSpam"] }),
			callerOf(SUB),
		);

		assert.deepEqual(seen, [{ neverSpam: null }]);
		assert.equal(response.flags.neverSpam, undefined);
	});
});

describe("AddressDetailOperations_updateAddress removing a flag (#615)", () => {
	it("clears the category override, which has no false-equivalent value to send", async () => {
		const seen: FlagsMergePatch[] = [];
		client = clientHolding(
			address({
				flags: { category: { value: "newsletter", setAt: 10 } },
			}),
			seen,
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["category"] }),
			callerOf(SUB),
		);

		assert.deepEqual(seen, [{ category: null }]);
		assert.equal(response.flags.category, undefined);
	});

	it("clears a boolean flag by the same route, leaving the untouched ones alone", async () => {
		const seen: FlagsMergePatch[] = [];
		client = clientHolding(
			address({
				flags: {
					muted: { value: true, setAt: 10 },
					vip: { value: true, setAt: 11 },
				},
			}),
			seen,
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["muted"] }),
			callerOf(SUB),
		);

		assert.equal(response.flags.muted, undefined);
		assert.deepEqual(response.flags.vip, { value: true, setAt: 11 });
	});

	it("removes a key named in both halves, because clearFlags is applied last", async () => {
		const seen: FlagsMergePatch[] = [];
		client = clientHolding(
			address({ flags: { muted: { value: true, setAt: 10 } } }),
			seen,
		);

		const response = await updateAddress(
			updateContextFor({
				flags: { muted: { value: true, setAt: 20 } },
				clearFlags: ["muted"],
			}),
			callerOf(SUB),
		);

		assert.deepEqual(seen, [{ muted: null }]);
		assert.equal(response.flags.muted, undefined);
	});
});

/**
 * The retroactive half of a sender-category override (#415). Setting the flag
 * enqueues one back-apply carrying the category it was set to; clearing it —
 * the revert-to-auto route — enqueues nothing, because the classifier's own
 * answer for mail already filed cannot be re-derived without every body.
 */
describe("AddressDetailOperations_updateAddress category back-apply (#415)", () => {
	it("enqueues a back-apply naming the sender and the set it was fired for", async () => {
		const fanout = recordingQueue();
		client = clientHolding(address({ flags: {} }), [], fanout);

		await updateAddress(
			updateContextFor({
				flags: { category: { value: "newsletter", setAt: 20 } },
			}),
			callerOf(SUB),
		);

		assert.equal(fanout.sent.length, 1);
		assert.deepEqual(fanout.sent[0]?.body, {
			type: "SenderCategoryBackApply",
			accountConfigId: ACCOUNT_CONFIG_ID,
			addressId: "addr-1",
			normalizedEmail: "amsterdam@pocahondas.nl",
			category: "newsletter",
			categorySetAt: 20,
		});
	});

	it("says the override is saved and names the retry when the queue refuses", async () => {
		client = clientHolding(
			address({ flags: {} }),
			[],
			failingQueue(new Error("AWS.SimpleQueueService.NonExistentQueue")),
		);

		await assert.rejects(
			updateAddress(
				updateContextFor({
					flags: { category: { value: "newsletter", setAt: 20 } },
				}),
				callerOf(SUB),
			),
			(error: Error) => {
				assert.match(error.message, /saved/);
				assert.match(error.message, /same category again/);
				return true;
			},
		);
	});

	it("enqueues nothing when the override is cleared back to auto", async () => {
		const fanout = recordingQueue();
		client = clientHolding(
			address({ flags: { category: { value: "newsletter", setAt: 10 } } }),
			[],
			fanout,
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["category"] }),
			callerOf(SUB),
		);

		assert.equal(response.flags.category, undefined);
		assert.deepEqual(fanout.sent, []);
	});

	it("enqueues nothing for a flag that has no bearing on classification", async () => {
		const fanout = recordingQueue();
		client = clientHolding(address({ flags: {} }), [], fanout);

		await updateAddress(
			updateContextFor({ flags: { muted: { value: true, setAt: 20 } } }),
			callerOf(SUB),
		);

		assert.deepEqual(fanout.sent, []);
	});
});
