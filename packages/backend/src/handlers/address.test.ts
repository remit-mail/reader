import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { AddressItem, ResultList } from "@remit/data-ports";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { AddressOperations } from "./address.js";

const searchAddresses =
	AddressOperations.AddressOperations_searchAddresses as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<ResultList<AddressItem>>;

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
