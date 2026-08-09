/**
 * The provider and the worker against each other. The worker module is loaded
 * with a stand-in for the worker global, so what runs here is the code that
 * ships inside the worker, over the same messages a real one exchanges.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type {
	ProviderStatus,
	SpellWorkerRequest,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import {
	openSpellProvider,
	type SpellWorkerPort,
} from "./rich-text-spellcheck-provider.js";
import {
	dictionaryFor,
	findMisspellings,
	suggestionsFor,
} from "./rich-text-spellcheck-words.js";

interface WorkerScope {
	postMessage(message: SpellWorkerResponse): void;
	addEventListener(
		type: "message",
		listener: (event: { data: SpellWorkerRequest }) => void,
	): void;
}

let receive: (event: { data: SpellWorkerRequest }) => void;
let deliver: ((message: SpellWorkerResponse) => void) | undefined;
let terminated = 0;

/** Wires the loaded worker module to a provider, the way a real port does. */
const port: SpellWorkerPort = {
	post: (message) => receive({ data: message }),
	listen: (listener) => {
		deliver = listener;
	},
	fail: () => {},
	terminate: () => {
		terminated += 1;
	},
};

before(async () => {
	const scope: WorkerScope = {
		postMessage: (message) => deliver?.(message),
		addEventListener: (_type, listener) => {
			receive = listener;
		},
	};
	Object.defineProperty(globalThis, "postMessage", {
		value: scope.postMessage,
		configurable: true,
	});
	Object.defineProperty(globalThis, "addEventListener", {
		value: scope.addEventListener,
		configurable: true,
	});
	await import("./rich-text-spellcheck-worker.js");
});

describe("the stub dictionary", () => {
	it("takes a region tag and answers for the language", () => {
		assert.ok(dictionaryFor("en-GB"), "a region variant reads the same words");
		assert.equal(
			dictionaryFor("de"),
			null,
			"no dictionary is not an empty one",
		);
	});

	it("ranges the words it does not hold", () => {
		const words = dictionaryFor("en");
		assert.ok(words);
		assert.deepEqual(findMisspellings("Ths report is redy today", words), [
			{ start: 0, end: 3 },
			{ start: 14, end: 18 },
		]);
		assert.deepEqual(
			findMisspellings("A report", words),
			[],
			"a single letter is not a word to check",
		);
	});

	it("offers the words a keystroke or two away, nearest first", () => {
		const words = dictionaryFor("en");
		assert.ok(words);
		assert.deepEqual(suggestionsFor("redy", words), ["ready", "read", "very"]);
		assert.deepEqual(
			suggestionsFor("recieve", words),
			["receive", "received"],
			"a swapped pair of letters is one keystroke, not two",
		);
		assert.deepEqual(
			suggestionsFor("Attachd", words),
			["Attached"],
			"a suggestion arrives dressed the way the word was written",
		);
		assert.equal(
			suggestionsFor("Ths", words).length,
			5,
			"a short word has many neighbours, and the menu takes five",
		);
		assert.deepEqual(
			suggestionsFor("qwertyuiop", words),
			[],
			"nothing near it is not the same as anything at all",
		);
		assert.deepEqual(
			suggestionsFor("report", words),
			[],
			"a word it holds needs no correcting",
		);
	});
});

describe("a provider over a worker", () => {
	it("opens, checks and closes", async () => {
		const seen: ProviderStatus[] = [];
		const provider = openSpellProvider("en", port);
		const unsubscribe = provider.onStatus((status) => seen.push(status));

		assert.deepEqual(
			seen.at(-1),
			{ state: "ready", language: "en" },
			"a listener that subscribes late still learns the worker is up",
		);

		const response = await provider.check({
			requestId: "7",
			language: "en",
			revision: 3,
			spans: [{ spanId: "a", text: "Ths report" }],
		});

		assert.equal(response.requestId, "7");
		assert.equal(response.revision, 3, "the answer carries the revision asked");
		assert.deepEqual(response.findings, [
			{
				spanId: "a",
				start: 0,
				end: 3,
				kind: "spelling",
				suggestions: [],
			},
		]);

		unsubscribe();
		provider.close();
		assert.equal(terminated, 1, "closing the provider takes the worker down");
	});

	it("answers each request with its own findings", async () => {
		const provider = openSpellProvider("en", port);
		const [first, second] = await Promise.all([
			provider.check({
				requestId: "1",
				language: "en",
				revision: 1,
				spans: [{ spanId: "a", text: "redy" }],
			}),
			provider.check({
				requestId: "2",
				language: "en",
				revision: 2,
				spans: [{ spanId: "b", text: "the report" }],
			}),
		]);

		assert.equal(first?.findings.length, 1);
		assert.equal(first?.findings[0]?.spanId, "a");
		assert.deepEqual(second?.findings, []);
		provider.close();
	});

	it("answers a correction menu one word at a time", async () => {
		const provider = openSpellProvider("en", port);
		const response = await provider.suggest({
			requestId: "9",
			language: "en",
			word: "redy",
		});

		assert.equal(response.requestId, "9");
		assert.equal(response.word, "redy");
		assert.deepEqual(response.suggestions, ["ready", "read", "very"]);
		provider.close();
	});

	it("tells a waiting menu when the worker stops answering", async () => {
		let raise: ((detail: string) => void) | undefined;
		const provider = openSpellProvider("en", {
			...port,
			post: () => {},
			listen: () => {},
			fail: (listener) => {
				raise = listener;
			},
		});
		const asking = provider.suggest({
			requestId: "1",
			language: "en",
			word: "redy",
		});
		raise?.("worker exited");

		await assert.rejects(asking, /worker exited/);
		provider.close();
	});

	it("says which language it has no words for", async () => {
		const provider = openSpellProvider("de", port);
		const response = await provider.check({
			requestId: "1",
			language: "de",
			revision: 1,
			spans: [{ spanId: "a", text: "Vielen Dank" }],
		});

		assert.deepEqual(
			response.findings,
			[],
			"a language with no dictionary marks nothing rather than everything",
		);
		provider.close();
	});

	it("passes on a failure the worker names itself", () => {
		const seen: ProviderStatus[] = [];
		let answer: ((message: SpellWorkerResponse) => void) | undefined;
		const provider = openSpellProvider("nl", {
			...port,
			post: () => {},
			listen: (listener) => {
				answer = listener;
			},
		});
		provider.onStatus((status) => seen.push(status));
		answer?.({
			type: "failed",
			language: "nl",
			reason: "download",
			detail: "503 fetching the dictionary",
		});

		assert.deepEqual(seen.at(-1), {
			state: "failed",
			language: "nl",
			reason: "download",
			detail: "503 fetching the dictionary",
		});
		provider.close();
	});

	it("reports a worker that fell over", () => {
		const seen: ProviderStatus[] = [];
		let raise: ((detail: string) => void) | undefined;
		const provider = openSpellProvider("en", {
			...port,
			post: () => {},
			listen: () => {},
			fail: (listener) => {
				raise = listener;
			},
		});
		provider.onStatus((status) => seen.push(status));
		raise?.("worker exited");

		assert.deepEqual(seen, [
			{ state: "opening", language: "en" },
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
