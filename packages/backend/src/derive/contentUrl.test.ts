import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildContentUrl, getContentDeliveryDomain } from "./contentUrl.js";

describe("buildContentUrl", () => {
	it("produces the /content/accounts/{cfg}/{acc}/messages/{msg}/parts/{part} layout the Lambda@Edge expects", () => {
		const url = buildContentUrl({
			domain: "https://abc123.cloudfront.net",
			accountConfigId: "cfg-alice",
			accountId: "acc-alice",
			messageId: "msg-1",
			partPath: "1.2",
		});

		assert.equal(
			url,
			"https://abc123.cloudfront.net/content/accounts/cfg-alice/acc-alice/messages/msg-1/parts/1.2",
		);
	});

	it("prepends https:// when the domain is given as a bare hostname", () => {
		const url = buildContentUrl({
			domain: "abc123.cloudfront.net",
			accountConfigId: "cfg-alice",
			accountId: "acc-alice",
			messageId: "msg-1",
			partPath: "1",
		});

		assert.equal(url.startsWith("https://abc123.cloudfront.net/"), true);
	});

	it("strips a trailing slash on the domain so the path doesn't double up", () => {
		const url = buildContentUrl({
			domain: "https://abc123.cloudfront.net/",
			accountConfigId: "cfg-alice",
			accountId: "acc-alice",
			messageId: "msg-1",
			partPath: "1",
		});

		assert.equal(
			url,
			"https://abc123.cloudfront.net/content/accounts/cfg-alice/acc-alice/messages/msg-1/parts/1",
		);
	});

	it("encodes each segment of partPath defensively (forward-slash kept as separator)", () => {
		const url = buildContentUrl({
			domain: "https://cdn.test",
			accountConfigId: "cfg",
			accountId: "acc",
			messageId: "msg",
			partPath: "1/strange path/3",
		});

		assert.equal(
			url,
			"https://cdn.test/content/accounts/cfg/acc/messages/msg/parts/1/strange%20path/3",
		);
	});

	it("nests accountConfigId before accountId so the Lambda@Edge prefix check matches", () => {
		const url = buildContentUrl({
			domain: "https://cdn.test",
			accountConfigId: "CFG",
			accountId: "ACC",
			messageId: "MSG",
			partPath: "1",
		});

		const segments = new URL(url).pathname.split("/");
		// ["", "content", "accounts", "CFG", "ACC", "messages", "MSG", "parts", "1"]
		assert.equal(segments[1], "content");
		assert.equal(segments[2], "accounts");
		assert.equal(segments[3], "CFG");
		assert.equal(segments[4], "ACC");
	});
});

describe("getContentDeliveryDomain", () => {
	const ORIGINAL = process.env.CONTENT_DELIVERY_DOMAIN;

	beforeEach(() => {
		delete process.env.CONTENT_DELIVERY_DOMAIN;
	});

	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.CONTENT_DELIVERY_DOMAIN;
		else process.env.CONTENT_DELIVERY_DOMAIN = ORIGINAL;
	});

	it("throws when CONTENT_DELIVERY_DOMAIN is unset (fail loud over silent placeholder, #299)", () => {
		assert.throws(
			() => getContentDeliveryDomain(),
			/CONTENT_DELIVERY_DOMAIN is not set/,
		);
	});

	it("throws when CONTENT_DELIVERY_DOMAIN is empty", () => {
		process.env.CONTENT_DELIVERY_DOMAIN = "";
		assert.throws(
			() => getContentDeliveryDomain(),
			/CONTENT_DELIVERY_DOMAIN is not set/,
		);
	});

	it("returns the env var value when set", () => {
		process.env.CONTENT_DELIVERY_DOMAIN = "https://abc.cloudfront.net";
		assert.equal(getContentDeliveryDomain(), "https://abc.cloudfront.net");
	});
});
