// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * Issue #615: the remove control in Settings > Senders sent `{ flags: {
 * [group]: null } }`. The server's openapi-backend validator doesn't honour
 * `nullable: true` on the `allOf`-wrapped flag schema TypeSpec emits for
 * `TrustedFlag | null`, so it rejects the null form as invalid — the same gap
 * `useToggleTrusted` already works around by sending `{ value: false }`
 * instead of `null`. This mock server enforces that same rejection, so the
 * pre-fix `null` body surfaces as a failed mutation (the row never clears)
 * rather than a silently accepted no-op.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "@/test-support/http";
import { SearchGroupPane } from "./senders";

const ADDRESS_ID = "addr-1";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let mutedFlag: { value: boolean; setAt: number } | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	mutedFlag = undefined;
});

const address = (): RemitImapAddressResponse =>
	({
		addressId: ADDRESS_ID,
		displayName: "Alex Rivera",
		normalizedEmail: "alex@example.com",
		flags: mutedFlag ? { muted: mutedFlag } : {},
	}) as RemitImapAddressResponse;

const readFlagsPatch = (call: HttpCall): unknown => {
	const body = call.body as { flags?: Record<string, unknown> } | undefined;
	return body?.flags?.muted;
};

const respond = (call: HttpCall): unknown => {
	if (call.method === "GET" && call.path === "/addresses/search") {
		return { items: [address()] };
	}
	if (call.method === "PATCH" && call.path === `/addresses/${ADDRESS_ID}`) {
		const patch = readFlagsPatch(call);
		if (patch === null) {
			return httpError(400, "flags.muted: nullable removal is not accepted");
		}
		mutedFlag = patch as { value: boolean; setAt: number };
		return address();
	}
	return {};
};

const mount = async (): Promise<void> => {
	mutedFlag = { value: true, setAt: 1_700_000_000_000 };
	http = mockFetch(respond);
	harness = createDomHarness();
	harness.renderApp(
		createElement(SearchGroupPane, { group: "muted", query: "alex" }),
	);
	await harness.waitFor(
		() => harness?.text().includes("alex@example.com") ?? false,
	);
};

describe("removing a sender flag (#615)", () => {
	it("sends a request body the server accepts, and the flag clears from the list", async () => {
		await mount();
		if (!harness) throw new Error("nothing mounted");

		harness.click(harness.byLabel("Remove muted flag"));

		await harness.waitFor(
			() => !(harness?.text().includes("alex@example.com") ?? true),
			"the unmuted sender to drop out of the muted list",
		);

		const patches = (http?.calls ?? []).filter(
			(call) =>
				call.method === "PATCH" && call.path === `/addresses/${ADDRESS_ID}`,
		);
		assert.equal(patches.length, 1);
		const sentFlag = readFlagsPatch(patches[0]) as
			| { value: boolean; setAt: number }
			| null
			| undefined;
		assert.notEqual(sentFlag, null, "the server rejects a null flag removal");
		assert.equal(sentFlag?.value, false);
		assert.equal(typeof sentFlag?.setAt, "number");
	});
});
