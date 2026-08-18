import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapAddressResponse } from "@remit/api-http-client";
import { offerableAsRecipient } from "./recipient-suggestions";

const setAt = 1;

const address = (
	over: Partial<RemitImapAddressResponse> = {},
): RemitImapAddressResponse =>
	({
		normalizedEmail: "sales@pharma.example",
		outboundCount: 0,
		replyCount: 0,
		flags: {},
		...over,
	}) as RemitImapAddressResponse;

describe("who the compose picker may offer", () => {
	it("offers a sender carrying no opinion", () => {
		assert.equal(offerableAsRecipient(address()), true);
	});

	it("refuses a sender met only on mail in Junk", () => {
		assert.equal(
			offerableAsRecipient(
				address({ flags: { junkOnly: { value: true, setAt } } }),
			),
			false,
		);
	});

	it("refuses a sender the account blocked", () => {
		assert.equal(
			offerableAsRecipient(
				address({ flags: { blocked: { value: true, setAt } } }),
			),
			false,
		);
	});

	it("refuses a blocked sender the search still has to return", () => {
		assert.equal(
			offerableAsRecipient(
				address({
					flags: {
						junkOnly: { value: true, setAt },
						blocked: { value: true, setAt },
					},
				}),
			),
			false,
		);
	});

	it("offers a muted sender, which is about notice and not about mail", () => {
		assert.equal(
			offerableAsRecipient(
				address({ flags: { muted: { value: true, setAt } } }),
			),
			true,
		);
	});

	it("offers a withheld sender the account has since sent mail to", () => {
		assert.equal(
			offerableAsRecipient(
				address({
					outboundCount: 1,
					flags: { junkOnly: { value: true, setAt } },
				}),
			),
			true,
		);
	});

	it("offers a withheld sender the account has since replied to", () => {
		assert.equal(
			offerableAsRecipient(
				address({ replyCount: 1, flags: { junkOnly: { value: true, setAt } } }),
			),
			true,
		);
	});

	it("offers a withheld sender the account has since named a VIP", () => {
		assert.equal(
			offerableAsRecipient(
				address({
					flags: {
						junkOnly: { value: true, setAt },
						vip: { value: true, setAt },
					},
				}),
			),
			true,
		);
	});

	it("offers a withheld sender the account has since trusted", () => {
		assert.equal(
			offerableAsRecipient(
				address({
					flags: {
						junkOnly: { value: true, setAt },
						trusted: { value: true, setAt },
					},
				}),
			),
			true,
		);
	});
});
