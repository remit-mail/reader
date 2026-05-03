import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type BodyPartLike,
	buildBodyPartResponses,
	extractAccountIdsFromBodyKey,
	isContentDisposition,
	isMediaType,
	isStorageNotFoundError,
} from "./message.js";

describe("isStorageNotFoundError", () => {
	it("matches S3 NoSuchKey via .name", () => {
		const err = Object.assign(new Error("missing"), { name: "NoSuchKey" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches S3 NoSuchKey via .Code", () => {
		const err = { Code: "NoSuchKey", message: "missing" };
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches filesystem ENOENT", () => {
		const err = Object.assign(new Error("no such file"), { code: "ENOENT" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("does not match generic errors", () => {
		assert.equal(isStorageNotFoundError(new Error("boom")), false);
	});

	it("does not match other S3 errors", () => {
		const err = Object.assign(new Error("denied"), { name: "AccessDenied" });
		assert.equal(isStorageNotFoundError(err), false);
	});

	it("does not match non-objects", () => {
		assert.equal(isStorageNotFoundError(null), false);
		assert.equal(isStorageNotFoundError(undefined), false);
		assert.equal(isStorageNotFoundError("oops"), false);
	});
});

describe("extractAccountIdsFromBodyKey", () => {
	it("extracts accountConfigId + accountId from a /accounts/{cfg}/{acc}/... s3 URI", () => {
		assert.deepEqual(
			extractAccountIdsFromBodyKey(
				"s3://remit-storage-dev/accounts/cfg-1/acc-abc/messages/msg-1/body.eml",
			),
			{ accountConfigId: "cfg-1", accountId: "acc-abc" },
		);
	});

	it("returns null when the URI shape doesn't match", () => {
		assert.equal(
			extractAccountIdsFromBodyKey("s3://bucket/some/other/path.bin"),
			null,
		);
	});

	it("returns null when only one segment is present (legacy path)", () => {
		assert.equal(
			extractAccountIdsFromBodyKey(
				"s3://bucket/accounts/legacy-acc/messages/m1/body.eml",
			),
			null,
		);
	});
});

describe("buildBodyPartResponses", () => {
	const PARTS: BodyPartLike[] = [
		{
			bodyPartId: "bp-1",
			mediaType: "TEXT",
			mediaSubtype: "HTML",
			sizeOctets: 100,
			isMultipart: false,
			partPath: "1",
		},
		{
			bodyPartId: "bp-2",
			mediaType: "IMAGE",
			mediaSubtype: "PNG",
			sizeOctets: 2048,
			isMultipart: false,
			contentId: "<inline-1@example.com>",
			disposition: "inline",
			dispositionFilename: "logo.png",
			partPath: "1.2",
		},
	];

	it("emits contentUrl pointing at /content/accounts/{cfg}/{acc}/messages/{msg}/parts/{partPath}", () => {
		const responses = buildBodyPartResponses(PARTS, {
			contentDeliveryDomain: "https://cdn.test",
			accountConfigId: "cfg-alice",
			accountId: "acc-alice",
			messageId: "msg-1",
		});

		assert.equal(responses.length, 2);
		assert.equal(
			responses[0].contentUrl,
			"https://cdn.test/content/accounts/cfg-alice/acc-alice/messages/msg-1/parts/1",
		);
		assert.equal(
			responses[1].contentUrl,
			"https://cdn.test/content/accounts/cfg-alice/acc-alice/messages/msg-1/parts/1.2",
		);
	});

	it("forwards contentId so the client can resolve cid:CONTENT_ID inline references", () => {
		const responses = buildBodyPartResponses(PARTS, {
			contentDeliveryDomain: "https://cdn.test",
			accountConfigId: "cfg",
			accountId: "acc",
			messageId: "m",
		});

		assert.equal(responses[0].contentId, undefined);
		assert.equal(responses[1].contentId, "<inline-1@example.com>");
	});

	it("emits a syntactically valid absolute URL for every part so the .url() zod check on BodyPartResponse.contentUrl passes (#299)", () => {
		const responses = buildBodyPartResponses(PARTS, {
			contentDeliveryDomain: "https://abc.cloudfront.net",
			accountConfigId: "cfg",
			accountId: "acc",
			messageId: "m",
		});
		for (const response of responses) {
			const parsed = new URL(response.contentUrl);
			assert.equal(parsed.protocol, "https:");
			assert.equal(parsed.host, "abc.cloudfront.net");
		}
	});

	it("preserves all existing BodyPartResponse fields verbatim", () => {
		const responses = buildBodyPartResponses(PARTS, {
			contentDeliveryDomain: "https://cdn.test",
			accountConfigId: "cfg",
			accountId: "acc",
			messageId: "m",
		});
		assert.equal(responses[1].bodyPartId, "bp-2");
		assert.equal(responses[1].mediaType, "IMAGE");
		assert.equal(responses[1].mediaSubtype, "PNG");
		assert.equal(responses[1].sizeOctets, 2048);
		assert.equal(responses[1].disposition, "inline");
		assert.equal(responses[1].dispositionFilename, "logo.png");
		assert.equal(responses[1].isMultipart, false);
	});

	it("throws on a mediaType outside the MediaType enum", () => {
		const bad: BodyPartLike[] = [
			{
				bodyPartId: "bp-bad",
				mediaType: "BOGUS",
				mediaSubtype: "PLAIN",
				sizeOctets: 0,
				isMultipart: false,
				partPath: "1",
			},
		];
		assert.throws(
			() =>
				buildBodyPartResponses(bad, {
					contentDeliveryDomain: "cdn.example.com",
					accountConfigId: "cfg",
					accountId: "acc",
					messageId: "m",
				}),
			/Invalid mediaType "BOGUS" on BodyPart bp-bad/,
		);
	});

	it("throws on a disposition outside the ContentDisposition enum", () => {
		const bad: BodyPartLike[] = [
			{
				bodyPartId: "bp-bad",
				mediaType: "TEXT",
				mediaSubtype: "PLAIN",
				sizeOctets: 0,
				isMultipart: false,
				partPath: "1",
				disposition: "weirdo",
			},
		];
		assert.throws(
			() =>
				buildBodyPartResponses(bad, {
					contentDeliveryDomain: "cdn.example.com",
					accountConfigId: "cfg",
					accountId: "acc",
					messageId: "m",
				}),
			/Invalid disposition "weirdo" on BodyPart bp-bad/,
		);
	});
});

describe("isMediaType", () => {
	it("accepts every value declared in the MediaType enum", () => {
		for (const value of [
			"TEXT",
			"IMAGE",
			"AUDIO",
			"VIDEO",
			"APPLICATION",
			"MULTIPART",
			"MESSAGE",
		]) {
			assert.equal(isMediaType(value), true, `expected ${value} to be valid`);
		}
	});

	it("rejects unknown strings, non-strings, and casing variants", () => {
		assert.equal(isMediaType("text"), false);
		assert.equal(isMediaType("BOGUS"), false);
		assert.equal(isMediaType(""), false);
		assert.equal(isMediaType(undefined), false);
		assert.equal(isMediaType(null), false);
		assert.equal(isMediaType(42), false);
	});
});

describe("isContentDisposition", () => {
	it("accepts every value declared in the ContentDisposition enum", () => {
		for (const value of ["inline", "attachment"]) {
			assert.equal(
				isContentDisposition(value),
				true,
				`expected ${value} to be valid`,
			);
		}
	});

	it("rejects unknown strings, casing variants, and non-strings", () => {
		assert.equal(isContentDisposition("Inline"), false);
		assert.equal(isContentDisposition("weirdo"), false);
		assert.equal(isContentDisposition(""), false);
		assert.equal(isContentDisposition(undefined), false);
		assert.equal(isContentDisposition(null), false);
		assert.equal(isContentDisposition(0), false);
	});
});
