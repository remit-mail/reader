import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
	AddressResponse,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type {
	AddressItem,
	FlagsMergePatch,
	ResultList,
} from "@remit/data-ports";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import { AddressDetailOperations, AddressOperations } from "./address.js";

const searchAddresses =
	AddressOperations.AddressOperations_searchAddresses as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<ResultList<AddressItem>>;

const updateAddress =
	AddressDetailOperations.AddressDetailOperations_updateAddress as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<AddressResponse>;

const SUB = "cognito-sub-704";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);

const eventFor = (sub: string): APIGatewayProxyEvent =>
	({
		requestContext: { authorizer: { claims: { sub } } },
	}) as unknown as APIGatewayProxyEvent;

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
	_resetForTest();
});

describe("AddressOperations_searchAddresses", () => {
	it("looks a partial term up against the caller's own addresses (#704)", async () => {
		const seen: Listing[] = [];
		setClient(clientReturning([address({})], seen));

		const response = await searchAddresses(
			contextFor({ q: "Po", limit: 8 }),
			eventFor(SUB),
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
		setClient(
			clientReturning(
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
			),
		);

		const response = await searchAddresses(
			contextFor({ q: "po" }),
			eventFor(SUB),
		);

		assert.deepEqual(
			response.items.map((item) => item.addressId),
			["addr-frequent", "addr-stranger"],
		);
	});

	it("asks for a suggestion-sized window when the caller names no limit", async () => {
		const seen: Listing[] = [];
		setClient(clientReturning([], seen));

		await searchAddresses(contextFor({ q: "po" }), eventFor(SUB));

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
): RemitClient =>
	({
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

describe("AddressDetailOperations_updateAddress removing a flag (#615)", () => {
	it("clears the category override, which has no false-equivalent value to send", async () => {
		const seen: FlagsMergePatch[] = [];
		setClient(
			clientHolding(
				address({
					flags: { category: { value: "newsletter", setAt: 10 } },
				}),
				seen,
			),
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["category"] }),
			eventFor(SUB),
		);

		assert.deepEqual(seen, [{ category: null }]);
		assert.equal(response.flags.category, undefined);
	});

	it("clears a boolean flag by the same route, leaving the untouched ones alone", async () => {
		const seen: FlagsMergePatch[] = [];
		setClient(
			clientHolding(
				address({
					flags: {
						muted: { value: true, setAt: 10 },
						vip: { value: true, setAt: 11 },
					},
				}),
				seen,
			),
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["muted"] }),
			eventFor(SUB),
		);

		assert.equal(response.flags.muted, undefined);
		assert.deepEqual(response.flags.vip, { value: true, setAt: 11 });
	});

	it("removes a key named in both halves, because clearFlags is applied last", async () => {
		const seen: FlagsMergePatch[] = [];
		setClient(
			clientHolding(
				address({ flags: { muted: { value: true, setAt: 10 } } }),
				seen,
			),
		);

		const response = await updateAddress(
			updateContextFor({
				flags: { muted: { value: true, setAt: 20 } },
				clearFlags: ["muted"],
			}),
			eventFor(SUB),
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
	const withStubbedQueue = (enqueued: SendMessageCommand[]): void => {
		process.env.SQS_QUEUE_URL_ACCOUNT_FANOUT =
			"http://localhost:9324/queue/account-fanout-test";
		mock.method(sqsClient, "send", async (command: SendMessageCommand) => {
			enqueued.push(command);
			return {};
		});
	};

	it("enqueues a back-apply naming the sender and the category just set", async () => {
		const enqueued: SendMessageCommand[] = [];
		withStubbedQueue(enqueued);
		setClient(clientHolding(address({ flags: {} }), []));

		await updateAddress(
			updateContextFor({
				flags: { category: { value: "newsletter", setAt: 20 } },
			}),
			eventFor(SUB),
		);

		assert.equal(enqueued.length, 1);
		assert.deepEqual(JSON.parse(String(enqueued[0]?.input.MessageBody)), {
			type: "SenderCategoryBackApply",
			accountConfigId: ACCOUNT_CONFIG_ID,
			addressId: "addr-1",
			normalizedEmail: "amsterdam@pocahondas.nl",
			category: "newsletter",
		});
	});

	it("enqueues nothing when the override is cleared back to auto", async () => {
		const enqueued: SendMessageCommand[] = [];
		withStubbedQueue(enqueued);
		setClient(
			clientHolding(
				address({ flags: { category: { value: "newsletter", setAt: 10 } } }),
				[],
			),
		);

		const response = await updateAddress(
			updateContextFor({ clearFlags: ["category"] }),
			eventFor(SUB),
		);

		assert.equal(response.flags.category, undefined);
		assert.deepEqual(enqueued, []);
	});

	it("enqueues nothing for a flag that has no bearing on classification", async () => {
		const enqueued: SendMessageCommand[] = [];
		withStubbedQueue(enqueued);
		setClient(clientHolding(address({ flags: {} }), []));

		await updateAddress(
			updateContextFor({ flags: { muted: { value: true, setAt: 20 } } }),
			eventFor(SUB),
		);

		assert.deepEqual(enqueued, []);
	});
});
