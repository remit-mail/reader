import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CheckResult, Reason } from "./verdict.js";
import {
	buildBody,
	defaultTemplate,
	escapeFor,
	expandTemplate,
	payloadValues,
	postWebhook,
	render,
} from "./webhook.js";

const result = (
	verdict: "healthy" | "degraded",
	reasons: readonly Reason[] = [],
): CheckResult => ({
	verdict,
	checkedAt: "2026-07-27T10:00:00.000Z",
	summary: verdict === "healthy" ? "remit is healthy" : "remit is degraded",
	reasons,
	counters: {},
});

const reason = (summary: string, detail?: string): Reason => ({
	code: "dead_letter_queue_not_empty",
	summary,
	detail,
});

describe("the default templates", () => {
	it("produces valid JSON Slack accepts, for a real reason set", () => {
		const body = buildBody(
			result("degraded", [
				reason(
					"3 messages are quarantined on 1 dead-letter queue (imap-sync-dlq)",
				),
				reason("2 of 5 accounts have not completed a sync in over 3h"),
			]),
			undefined,
			"application/json",
		);
		const parsed = JSON.parse(body) as { text: string };
		assert.match(parsed.text, /^remit is degraded\n/);
		assert.match(parsed.text, /• 3 messages are quarantined/);
		assert.match(parsed.text, /• 2 of 5 accounts/);
	});

	it("produces a plain body for ntfy, with real newlines", () => {
		const body = buildBody(
			result("degraded", [
				reason("1 worker has stopped polling (imap-worker)"),
			]),
			undefined,
			"text/plain",
		);
		assert.equal(
			body,
			"remit is degraded\n• 1 worker has stopped polling (imap-worker)",
		);
	});

	it("says so plainly when a recovery has nothing to list", () => {
		const body = buildBody(result("healthy"), undefined, "text/plain");
		assert.equal(body, "remit is healthy\nno problems found");
	});
});

describe("escaping", () => {
	it("keeps a quote, a backslash and a newline from breaking the JSON document", () => {
		const body = buildBody(
			result("degraded", [reason('queue "odd\\name"\nsecond line')]),
			undefined,
			"application/json",
		);
		const parsed = JSON.parse(body) as { text: string };
		assert.match(parsed.text, /queue "odd\\name"/);
		assert.match(parsed.text, /\nsecond line/);
	});

	it("survives a control character", () => {
		const body = buildBody(
			result("degraded", [reason("tab\there and a bell")]),
			undefined,
			"application/json",
		);
		assert.doesNotThrow(() => JSON.parse(body));
	});

	it("leaves a plain-text body exactly as it reads", () => {
		const body = buildBody(
			result("degraded", [reason('a "quoted" thing')]),
			undefined,
			"text/plain",
		);
		assert.match(body, /a "quoted" thing/);
	});

	it("escapes for a charset-qualified JSON content type too", () => {
		assert.equal(escapeFor("application/json; charset=utf-8")('"'), '\\"');
		assert.equal(escapeFor("text/plain; charset=utf-8")('"'), '"');
	});
});

describe("operator templates", () => {
	it("substitutes the three documented placeholders", () => {
		const body = buildBody(
			result("degraded", [reason("one thing")]),
			'{"title":"{{verdict}}","body":"{{summary}} / {{reasons}}"}',
			"application/json",
		);
		const parsed = JSON.parse(body) as { title: string; body: string };
		assert.equal(parsed.title, "degraded");
		assert.equal(parsed.body, "remit is degraded / • one thing");
	});

	it("leaves anything else in braces alone", () => {
		assert.equal(
			render(
				"{{summary}} {{unknown}} {not a placeholder}",
				{ verdict: "healthy", summary: "s", reasons: "r" },
				(value) => value,
			),
			"s {{unknown}} {not a placeholder}",
		);
	});

	it("turns a backslash-n in a plain-text template into a newline, since .env cannot carry one", () => {
		assert.equal(expandTemplate("a\\nb", "text/plain"), "a\nb");
		assert.equal(expandTemplate("a\\tb", "text/plain"), "a\tb");
	});

	it("leaves a JSON template's own escapes alone", () => {
		assert.equal(
			expandTemplate('{"t":"a\\nb"}', "application/json"),
			'{"t":"a\\nb"}',
		);
	});

	it("defaults by content type", () => {
		assert.match(defaultTemplate("application/json"), /^\{"text"/);
		assert.equal(defaultTemplate("text/plain"), "{{summary}}\n{{reasons}}");
	});
});

describe("what a payload may carry", () => {
	it("never reaches a reason's local-only detail", () => {
		const values = payloadValues(
			result("degraded", [
				reason(
					"1 of 3 accounts have not completed a sync in over 3h",
					"0f8a-secret: 40000s",
				),
			]),
		);
		for (const value of Object.values(values)) {
			assert.ok(!value.includes("0f8a-secret"));
		}
	});

	it("has exactly three fields, so nothing new can leak in by accident", () => {
		assert.deepEqual(Object.keys(payloadValues(result("healthy"))).sort(), [
			"reasons",
			"summary",
			"verdict",
		]);
	});
});

describe("postWebhook", () => {
	it("posts the rendered body with the declared content type", async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		await postWebhook(
			{
				url: "https://hooks.example/x",
				template: undefined,
				contentType: "application/json",
				timeoutMs: 1000,
			},
			result("healthy"),
			(async (url: string, init: RequestInit) => {
				seen = { url, init };
				return new Response("ok", { status: 200 });
			}) as unknown as typeof fetch,
		);
		assert.equal(seen?.url, "https://hooks.example/x");
		assert.equal(seen?.init.method, "POST");
		assert.deepEqual(seen?.init.headers, {
			"content-type": "application/json",
		});
		assert.doesNotThrow(() => JSON.parse(String(seen?.init.body)));
	});

	it("reports a rejected payload rather than swallowing it", async () => {
		await assert.rejects(
			postWebhook(
				{
					url: "https://hooks.example/x",
					template: undefined,
					contentType: "application/json",
					timeoutMs: 1000,
				},
				result("healthy"),
				(async () =>
					new Response("no_text", { status: 400 })) as unknown as typeof fetch,
			),
			/HTTP 400/,
		);
	});
});
