import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AuthenticationResults,
	parseAuthenticationResults,
} from "./authenticationResults.js";

const parse = (value: string): AuthenticationResults => {
	const parsed = parseAuthenticationResults(value);
	assert.ok(parsed, `expected ${JSON.stringify(value)} to parse`);
	return parsed;
};

const summary = (value: string): string[] =>
	parse(value).results.map((r) =>
		[`${r.method}=${r.result}`, ...r.properties].flat().join(" "),
	);

describe("parseAuthenticationResults", () => {
	it("reads the authserv-id and every resinfo", () => {
		const parsed = parse(
			"mx.example.com; dkim=pass header.d=acme.example; spf=pass smtp.mailfrom=acme.example; dmarc=pass header.from=acme.example",
		);
		assert.equal(parsed.authservId, "mx.example.com");
		assert.deepEqual(summary("mx.example.com; dkim=pass header.d=a.example"), [
			"dkim=pass header.d a.example",
		]);
		assert.deepEqual(
			parsed.results.map((r) => r.method),
			["dkim", "spf", "dmarc"],
		);
	});

	it("keeps a semicolon inside a comment within its own resinfo", () => {
		assert.deepEqual(
			summary(
				"gw.example; dkim=fail (1024-bit key; unprotected) header.d=acme.example; dkim=fail header.d=relay.example; dmarc=fail (p=REJECT) header.from=acme.example",
			),
			[
				"dkim=fail header.d acme.example",
				"dkim=fail header.d relay.example",
				"dmarc=fail header.from acme.example",
			],
		);
	});

	it("never reads a result out of another method's comment", () => {
		assert.deepEqual(
			summary(
				"mx.example.net; arc=fail (i=1 spf=pass; dkim=fail\r\n  header.d=arcsigner.example; dmarc=fail); spf=pass smtp.mailfrom=acme.example;\r\n  dmarc=fail header.from=acme.example",
			),
			[
				"arc=fail",
				"spf=pass smtp.mailfrom acme.example",
				"dmarc=fail header.from acme.example",
			],
		);
	});

	it("strips nested comments and escaped parentheses", () => {
		assert.deepEqual(
			summary(
				"mx.example (outer (inner; dkim=pass) \\) still; comment); dkim=fail (a (b; c) d) header.d=acme.example",
			),
			["dkim=fail header.d acme.example"],
		);
	});

	it("keeps a semicolon inside a quoted reason", () => {
		assert.deepEqual(
			summary(
				'gw.example; dkim=fail reason="verification failed; body hash mismatch" header.d=acme.example; dmarc=fail header.from=acme.example',
			),
			[
				"dkim=fail reason verification failed; body hash mismatch header.d acme.example",
				"dmarc=fail header.from acme.example",
			],
		);
	});

	it("lower-cases methods, results and property names", () => {
		const parsed = parse(
			"GW.EXAMPLE; DKIM=FAIL HEADER.D=EVIL.EXAMPLE; DMARC=FAIL",
		);
		assert.equal(parsed.authservId, "gw.example");
		assert.deepEqual(
			summary("GW.EXAMPLE; DKIM=FAIL HEADER.D=EVIL.EXAMPLE; DMARC=FAIL"),
			["dkim=fail header.d EVIL.EXAMPLE", "dmarc=fail"],
		);
	});

	it("accepts a comment before the method name", () => {
		assert.deepEqual(
			summary(
				"mx.example.com; (a comment) dkim=pass header.d=acme.example; dmarc=fail",
			),
			["dkim=pass header.d acme.example", "dmarc=fail"],
		);
	});

	it("accepts whitespace around = and .", () => {
		assert.deepEqual(
			summary(
				"mx.example.com; dkim = fail header . d = evil.example; dmarc=fail",
			),
			["dkim=fail header.d evil.example", "dmarc=fail"],
		);
	});

	it("reads folded continuation lines", () => {
		assert.deepEqual(
			summary(
				"mx.example.com;\r\n\tdkim=pass header.d=acme.example;\r\n\tdmarc=fail header.from=acme.example",
			),
			[
				"dkim=pass header.d acme.example",
				"dmarc=fail header.from acme.example",
			],
		);
	});

	it("finds a result after hundreds of filler properties", () => {
		const filler = Array.from(
			{ length: 400 },
			(_, n) => `x-filler.p${n}=v${n}`,
		).join(" ");
		const parsed = parse(
			`mx.example.com; spf=none ${filler}; dkim=fail header.d=acme.example`,
		);
		assert.equal(parsed.results[0].properties.size, 400);
		assert.equal(parsed.results[1].properties.get("header.d"), "acme.example");
	});

	it("reads a result that carries no properties", () => {
		assert.deepEqual(summary("gw.example; dkim=fail; dmarc=fail"), [
			"dkim=fail",
			"dmarc=fail",
		]);
	});

	it("reads method versions, an authres-version and a trailing semicolon", () => {
		const parsed = parse("mx.example 1; dkim/1=pass header.d=acme.example;");
		assert.equal(parsed.authservId, "mx.example");
		assert.deepEqual(
			summary("mx.example 1; dkim/1=pass header.d=acme.example;"),
			["dkim=pass header.d acme.example"],
		);
	});

	it("reads the explicit no-result form", () => {
		assert.deepEqual(parse("mx.example.com; none"), {
			authservId: "mx.example.com",
			results: [],
		});
	});

	it("reads a header that omits the authserv-id", () => {
		const parsed = parse(
			"spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=acme.example; dkim=pass (signature was verified) header.d=acme.example;dmarc=pass action=none header.from=acme.example;compauth=pass reason=100",
		);
		assert.equal(parsed.authservId, "");
		assert.deepEqual(
			parsed.results.map((r) => `${r.method}=${r.result}`),
			["spf=pass", "dkim=pass", "dmarc=pass", "compauth=pass"],
		);
	});

	for (const [label, value] of [
		["an empty header", "   "],
		["an authserv-id alone", "mx.example.com"],
		["an authserv-id with an empty resinfo", "mx.example.com;"],
		["an unterminated comment", "mx.example; dmarc=pass (oops"],
		["an unbalanced closing parenthesis", "mx.example; dmarc=pass oops)"],
		["an unterminated quoted string", 'mx.example; dkim=fail reason="oops'],
		["a word with no value", "mx.example; dmarc=pass stray"],
		["a key with no value", "mx.example; dmarc=pass header.from="],
		["a resinfo with no method", "mx.example; header.d=acme.example"],
		["a quoted result", 'mx.example; dmarc="pass"'],
		[
			"two words where a key belongs",
			"mx.example; dmarc=pass extra header.from=a.example",
		],
		["no-result mixed with a result", "mx.example; none; dmarc=pass"],
	] as const) {
		it(`yields no result for ${label}`, () => {
			assert.equal(parseAuthenticationResults(value), null);
		});
	}
});
