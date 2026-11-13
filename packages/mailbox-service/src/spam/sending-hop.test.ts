import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendingHop } from "./sending-hop.js";

const received = (value: string) => ({ name: "Received", value });

describe("sendingHop", () => {
	it("takes the hop the provider's SPF check judged, not the top hop", () => {
		assert.deepEqual(
			sendingHop([
				{
					name: "Authentication-Results",
					value:
						"mx.provider.example; spf=pass (provider.example: domain of a@shop.example designates 198.51.100.7 as permitted sender) smtp.mailfrom=a@shop.example",
				},
				received(
					"from relay.provider.example (relay.provider.example [203.0.113.2]) by store.provider.example",
				),
				received(
					"from mx.shop.example (mail.shop.example. [198.51.100.7]) by mx.provider.example",
				),
				received("from laptop (unknown [10.0.0.4]) by mx.shop.example"),
			]),
			{
				ip: "198.51.100.7",
				helo: "mx.shop.example",
				hostname: "mail.shop.example",
			},
		);
	});

	it("reads Received-SPF's client-ip and an Exim hop's helo", () => {
		assert.deepEqual(
			sendingHop([
				{ name: "Received-SPF", value: "pass client-ip=2001:db8::25;" },
				received(
					"from mail.shop.example ([2001:db8::25] helo=mx.shop.example) by mx.provider.example",
				),
			]),
			{
				ip: "2001:db8::25",
				helo: "mx.shop.example",
				hostname: "mail.shop.example",
			},
		);
	});

	it("falls back to the first hop from a public address", () => {
		assert.deepEqual(
			sendingHop([
				received(
					"from filter.internal (localhost [127.0.0.1]) by mx.provider.example",
				),
				received(
					"from mx.shop.example (unknown [198.51.100.7]) by filter.internal",
				),
			]),
			{ ip: "198.51.100.7", helo: "mx.shop.example", hostname: "" },
		);
	});
});
