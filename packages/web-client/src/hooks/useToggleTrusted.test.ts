import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapEnvelopeAddressResponse,
} from "@remit/api-http-client/types.gen.ts";
import { patchDescribeMessage, patchEnvelopeAddress } from "./useToggleTrusted";

const NOW = 1_700_000_000_000;

const makeAddr = (
	overrides: Partial<RemitImapEnvelopeAddressResponse> & {
		addressId: string;
	},
): RemitImapEnvelopeAddressResponse =>
	({
		normalizedEmail: "x@example.com",
		addressRole: "from",
		addressOrder: 0,
		...overrides,
	}) as RemitImapEnvelopeAddressResponse;

describe("patchEnvelopeAddress", () => {
	test("ignores addresses with non-matching addressId", () => {
		const addr = makeAddr({ addressId: "addr-other" });
		const result = patchEnvelopeAddress(addr, "addr-target", true, NOW);
		assert.equal(result, addr);
	});

	test("sets trusted flag when toggled on", () => {
		const addr = makeAddr({ addressId: "addr-1" });
		const result = patchEnvelopeAddress(addr, "addr-1", true, NOW);
		assert.equal(result.flags?.trusted?.value, true);
		assert.equal(result.flags?.trusted?.setAt, NOW);
	});

	test("removes trusted flag when toggled off", () => {
		const addr = makeAddr({
			addressId: "addr-1",
			flags: { trusted: { value: true, setAt: 1 } },
		});
		const result = patchEnvelopeAddress(addr, "addr-1", false, NOW);
		assert.equal(result.flags?.trusted, undefined);
	});

	test("preserves other flags when toggling trust off", () => {
		const addr = makeAddr({
			addressId: "addr-1",
			flags: {
				trusted: { value: true, setAt: 1 },
				vip: { value: true, setAt: 2 },
			},
		});
		const result = patchEnvelopeAddress(addr, "addr-1", false, NOW);
		assert.equal(result.flags?.vip?.value, true);
		assert.equal(result.flags?.trusted, undefined);
	});
});

describe("patchDescribeMessage", () => {
	const baseDescribe = (
		from: RemitImapEnvelopeAddressResponse[],
	): RemitImapDescribeMessageResponse =>
		({
			message: {
				messageId: "m",
				mailboxId: "mb",
				uid: 1,
				rfc822Size: 1,
				internalDate: 1,
			},
			envelope: {
				messageId: "m",
				date: 1,
				from,
				to: [],
				cc: [],
				bcc: [],
				replyTo: [],
				senderTrust: "unknown",
			},
			flags: [],
			bodyParts: [],
			references: [],
		}) as RemitImapDescribeMessageResponse;

	test("flips only the matching address across all roles", () => {
		const target = makeAddr({ addressId: "a-1" });
		const other = makeAddr({ addressId: "a-2" });
		const data = baseDescribe([target, other]);
		const result = patchDescribeMessage(data, "a-1", true, NOW);
		assert.equal(result.envelope.from[0].flags?.trusted?.value, true);
		assert.equal(result.envelope.from[1].flags?.trusted, undefined);
	});

	test("rollback semantics: original data is unchanged (immutable patch)", () => {
		const target = makeAddr({ addressId: "a-1" });
		const data = baseDescribe([target]);
		patchDescribeMessage(data, "a-1", true, NOW);
		assert.equal(data.envelope.from[0].flags, undefined);
	});
});
