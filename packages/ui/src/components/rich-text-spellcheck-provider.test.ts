/**
 * The provider against the messages a worker sends, without a worker: what is
 * under test is the protocol — which status a message publishes, which request
 * an answer settles, and what a menu is told when nothing comes back. The
 * engine itself is proved against real dictionaries in
 * `rich-text-spellcheck-worker.test.ts`.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type {
	ProviderStatus,
	SpellWorkerRequest,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import {
	dictionaryTagFor,
	spellcheckBase,
	spellcheckLanguages,
} from "./rich-text-spellcheck-languages.js";
import {
	CHECK_DEADLINE_MS,
	openSpellProvider,
	type SpellWorkerPort,
	SUGGEST_DEADLINE_MS,
} from "./rich-text-spellcheck-provider.js";
import {
	findMisspellings,
	normaliseWord,
	wordsIn,
} from "./rich-text-spellcheck-words.js";

interface Wire {
	readonly port: SpellWorkerPort;
	readonly posted: SpellWorkerRequest[];
	answer(message: SpellWorkerResponse): void;
	fall(detail: string): void;
	terminated(): number;
}

const wire = (): Wire => {
	const posted: SpellWorkerRequest[] = [];
	let deliver: ((message: SpellWorkerResponse) => void) | undefined;
	let raise: ((detail: string) => void) | undefined;
	let terminated = 0;
	return {
		posted,
		port: {
			post: (message) => posted.push(message),
			listen: (listener) => {
				deliver = listener;
			},
			fail: (listener) => {
				raise = listener;
			},
			terminate: () => {
				terminated += 1;
			},
		},
		answer: (message) => deliver?.(message),
		fall: (detail) => raise?.(detail),
		terminated: () => terminated,
	};
};

const ready = (wired: Wire, language: string): void =>
	wired.answer({ type: "ready", language });

describe("the tokeniser", () => {
	it("takes words and leaves single letters alone", () => {
		assert.deepEqual(
			wordsIn("A report is redy").map((range) => range.start),
			[2, 9, 12],
			"an initial is not a word to check",
		);
	});

	it("ranges only what the checker does not know", () => {
		const known = (word: string) => word.toLowerCase() !== "ths";
		assert.deepEqual(findMisspellings("Ths report", known), [
			{ start: 0, end: 3 },
		]);
	});

	it("reads a curly apostrophe as the straight one", () => {
		assert.equal(normaliseWord("Don’t"), "don't");
	});
});

describe("what this build carries", () => {
	it("has nothing where no build staged anything", () => {
		assert.deepEqual(spellcheckLanguages(), []);
		assert.equal(spellcheckBase(), "/spellcheck/");
	});

	it("takes the region dictionary where the build has it", () => {
		const built = ["en", "en-GB", "nl"];
		assert.equal(dictionaryTagFor("en-GB", built), "en-GB");
		assert.equal(dictionaryTagFor("EN-gb", built), "en-GB");
	});

	it("falls back to the language where the region is not staged", () => {
		assert.equal(dictionaryTagFor("nl-BE", ["en", "nl"]), "nl");
		assert.equal(
			dictionaryTagFor("de", ["en", "nl"]),
			null,
			"no dictionary is not an empty one",
		);
	});
});

describe("a provider over a worker", () => {
	it("opens on the language and the place the build serves it from", () => {
		const wired = wire();
		const provider = openSpellProvider("nl", "/spellcheck/", wired.port);
		assert.deepEqual(wired.posted, [
			{ type: "open", language: "nl", base: "/spellcheck/" },
		]);
		provider.close();
	});

	it("carries the download rather than a verdict about it", () => {
		const wired = wire();
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("nl", "/spellcheck/", wired.port);
		provider.onStatus((status) => seen.push(status));

		assert.deepEqual(seen.at(-1), {
			state: "opening",
			language: "nl",
			bytesLoaded: 0,
			bytesTotal: 0,
		});

		wired.answer({
			type: "opening",
			language: "nl",
			bytesLoaded: 65_536,
			bytesTotal: 702_464,
		});

		assert.deepEqual(
			seen.at(-1),
			{
				state: "opening",
				language: "nl",
				bytesLoaded: 65_536,
				bytesTotal: 702_464,
			},
			"the two numbers reach whatever decides five seconds is long",
		);
		provider.close();
	});

	it("settles each request with its own answer", async () => {
		const wired = wire();
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		ready(wired, "en");

		const first = provider.check({
			requestId: "1",
			language: "en",
			revision: 1,
			spans: [{ spanId: "a", text: "Ths report" }],
		});
		const second = provider.check({
			requestId: "2",
			language: "en",
			revision: 2,
			spans: [{ spanId: "b", text: "the report" }],
		});

		wired.answer({
			type: "checked",
			requestId: "2",
			revision: 2,
			findings: [],
		});
		wired.answer({
			type: "checked",
			requestId: "1",
			revision: 1,
			findings: [
				{ spanId: "a", start: 0, end: 3, kind: "spelling", suggestions: [] },
			],
		});

		assert.equal((await second).findings.length, 0);
		assert.equal(
			(await first).revision,
			1,
			"the answer carries what was asked",
		);
		provider.close();
		assert.equal(wired.terminated(), 1, "closing takes the worker down");
	});

	it("tells a waiting menu when the worker stops answering", async () => {
		const wired = wire();
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		const asking = provider.suggest({
			requestId: "1",
			language: "en",
			word: "redy",
		});
		wired.fall("worker exited");

		await assert.rejects(asking, /worker exited/);
		provider.close();
	});

	it("tells a waiting menu when the checker closes under it", async () => {
		const wired = wire();
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		const asking = provider.suggest({
			requestId: "1",
			language: "en",
			word: "redy",
		});
		provider.close();

		await assert.rejects(asking, /the checker closed/);
	});

	it("gives up on a worker that took the word and went quiet", async () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const wired = wire();
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		const asking = provider.suggest({
			requestId: "1",
			language: "en",
			word: "redy",
		});

		mock.timers.tick(SUGGEST_DEADLINE_MS);

		await assert.rejects(
			asking,
			/no suggestions for "redy"/,
			"skeleton rows that will never fill become the failure row instead",
		);
		mock.timers.reset();
		provider.close();
	});

	it("calls a checker that took the pass and went quiet stopped", async () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const wired = wire();
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("nl", "/spellcheck/", wired.port);
		provider.onStatus((status) => seen.push(status));
		ready(wired, "nl");

		const pass = provider.check({
			requestId: "1",
			language: "nl",
			revision: 7,
			spans: [{ spanId: "a", text: "De vergaderingg" }],
		});

		mock.timers.tick(CHECK_DEADLINE_MS);
		mock.timers.reset();

		assert.deepEqual(
			await pass,
			{ requestId: "1", revision: 7, findings: [] },
			"a pass nobody answers ends, rather than hanging on a promise",
		);
		const last = seen.at(-1);
		assert.ok(last?.state === "failed", "a frozen engine is a failure");
		assert.equal(last.reason, "worker");
		assert.match(
			last.detail,
			/nl checker did not answer/,
			"a frozen engine is indistinguishable from clean text unless it says so",
		);
		provider.close();
	});

	it("says a checker stopped once, however many passes were waiting", async () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const wired = wire();
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		provider.onStatus((status) => seen.push(status));
		ready(wired, "en");

		const passes = [1, 2].map((nth) =>
			provider.check({
				requestId: `${nth}`,
				language: "en",
				revision: nth,
				spans: [{ spanId: "a", text: "Ths report" }],
			}),
		);

		mock.timers.tick(CHECK_DEADLINE_MS);
		mock.timers.reset();

		await Promise.all(passes);
		assert.equal(
			seen.filter((status) => status.state === "failed").length,
			1,
			"one stopped checker is one banner",
		);
		provider.close();
	});

	it("passes on a failure the worker names itself", () => {
		const wired = wire();
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("nl", "/spellcheck/", wired.port);
		provider.onStatus((status) => seen.push(status));
		wired.answer({
			type: "failed",
			language: "nl",
			reason: "download",
			detail: "/spellcheck/dictionaries/nl/index.dic answered 503",
		});

		assert.deepEqual(seen.at(-1), {
			state: "failed",
			language: "nl",
			reason: "download",
			detail: "/spellcheck/dictionaries/nl/index.dic answered 503",
		});
		provider.close();
	});

	it("reports a worker that fell over", () => {
		const wired = wire();
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("en", "/spellcheck/", wired.port);
		provider.onStatus((status) => seen.push(status));
		wired.fall("worker exited");

		assert.deepEqual(seen, [
			{ state: "opening", language: "en", bytesLoaded: 0, bytesTotal: 0 },
			{
				state: "failed",
				language: "en",
				reason: "worker",
				detail: "worker exited",
			},
		]);
		provider.close();
	});
});
