/**
 * The worker against real dictionaries. What runs here is the code that ships
 * inside the worker, over the Hunspell build in `build/hunspell/` and the
 * upstream `.aff`/`.dic` pairs the image stages — so a language that passes
 * here is a language a writer is actually checked in.
 *
 * The engine and the dictionaries are fetched at runtime, so the fetch is where
 * this stands in: file URLs into `build/` and `node_modules/`, byte for byte
 * what the server would hand a browser.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	SpellWorkerRequest,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";

const require = createRequire(import.meta.url);
const engineDir = fileURLToPath(
	new URL("../../../../build/hunspell/", import.meta.url),
);
const BASE = pathToFileURL(engineDir).href;

const dictionaryDir = (tag: string): string =>
	dirname(require.resolve(`dictionary-${tag.toLowerCase()}/package.json`));

/** The one path that answers 503, so the download failure has a producer. */
let refuse: string | null = null;

const served = async (url: string): Promise<Response> => {
	if (url === refuse) return new Response("no", { status: 503 });
	const dictionary = /dictionaries\/([^/]+)\/(index\.(?:aff|dic))$/.exec(url);
	const path = dictionary
		? join(dictionaryDir(dictionary[1]), dictionary[2])
		: fileURLToPath(url);
	const bytes = await readFile(path);
	return new Response(bytes, {
		headers: { "content-length": String(bytes.byteLength) },
	});
};

let post: (message: SpellWorkerRequest) => void;
const heard: SpellWorkerResponse[] = [];
const waiting = new Map<string, (message: SpellWorkerResponse) => void>();

const nextMessage = <T extends SpellWorkerResponse["type"]>(
	type: T,
): Promise<Extract<SpellWorkerResponse, { type: T }>> =>
	new Promise((resolve) => {
		waiting.set(type, (message) =>
			resolve(message as Extract<SpellWorkerResponse, { type: T }>),
		);
	});

const openOn = async (
	tag: string,
): Promise<Extract<SpellWorkerResponse, { type: "ready" | "failed" }>> => {
	const ready = nextMessage("ready");
	const failed = nextMessage("failed");
	post({ type: "open", language: tag, base: BASE });
	return Promise.race([ready, failed]);
};

const checked = async (
	tag: string,
	text: string,
): Promise<readonly string[]> => {
	const answer = nextMessage("checked");
	post({
		type: "check",
		requestId: "1",
		language: tag,
		revision: 1,
		spans: [{ spanId: "a", text }],
	});
	const { findings } = await answer;
	return findings.map((finding) => text.slice(finding.start, finding.end));
};

const suggested = async (tag: string, word: string): Promise<string[]> => {
	const answer = nextMessage("suggested");
	post({ type: "suggest", requestId: "1", language: tag, word });
	return [...(await answer).suggestions];
};

before(async () => {
	Object.defineProperty(globalThis, "fetch", {
		value: (input: RequestInfo | URL) => served(String(input)),
		configurable: true,
	});
	Object.defineProperty(globalThis, "postMessage", {
		value: (message: SpellWorkerResponse) => {
			heard.push(message);
			const settle = waiting.get(message.type);
			if (!settle) return;
			waiting.delete(message.type);
			settle(message);
		},
		configurable: true,
	});
	Object.defineProperty(globalThis, "addEventListener", {
		value: (
			_type: string,
			listener: (event: { data: SpellWorkerRequest }) => void,
		) => {
			post = (message) => listener({ data: message });
		},
		configurable: true,
	});
	await import("./rich-text-spellcheck-worker.js");
});

describe("English, against SCOWL", () => {
	it("marks what is misspelt and leaves the rest alone", async () => {
		assert.equal((await openOn("en")).type, "ready");
		assert.deepEqual(await checked("en", "Ths report is redy today"), [
			"Ths",
			"redy",
		]);
		assert.deepEqual(
			await checked("en", "The meeting notes are attached."),
			[],
			"a sentence of real words carries no marks",
		);
	});

	it("offers the correction a writer meant", async () => {
		assert.ok(
			(await suggested("en", "recieve")).includes("receive"),
			"the engine suggests, and it knows the word",
		);
		assert.ok((await suggested("en", "meetign")).includes("meeting"));
	});

	it("reports the bytes as they arrive", () => {
		const progress = heard.filter((message) => message.type === "opening");
		assert.ok(progress.length > 0, "a download that says nothing looks broken");
		const last = progress.at(-1);
		assert.ok(last && last.bytesLoaded > 0 && last.bytesTotal > 0);
	});
});

describe("British English, against the same source", () => {
	it("takes the spellings the other English does not", async () => {
		assert.equal((await openOn("en-GB")).type, "ready");
		assert.deepEqual(
			await checked("en-GB", "I will organise the colour of the centre."),
			[],
		);
		assert.deepEqual(
			await checked("en-GB", "The kolour of the sentre."),
			["kolour", "sentre"],
			"a real British misspelling is still a misspelling",
		);
	});
});

describe("Dutch, against OpenTaal", () => {
	it("knows the words the stub never did", async () => {
		assert.equal((await openOn("nl")).type, "ready");
		assert.deepEqual(
			await checked(
				"nl",
				"De vergadering van vanmiddag gaat over de begroting.",
			),
			[],
		);
	});

	it("marks a Dutch misspelling and corrects it in Dutch", async () => {
		assert.deepEqual(
			await checked("nl", "De vergaderingg gaat over de begrooting."),
			["vergaderingg", "begrooting"],
		);
		assert.ok((await suggested("nl", "vergaderingg")).includes("vergadering"));
	});
});

describe("when the dictionary does not arrive", () => {
	it("says which file and what it answered", async () => {
		refuse = `${BASE}dictionaries/nl/index.dic`;
		const answer = await openOn("nl");
		refuse = null;

		assert.equal(answer.type, "failed");
		assert.equal(answer.type === "failed" && answer.reason, "download");
		assert.match(
			answer.type === "failed" ? answer.detail : "",
			/index\.dic answered 503/,
			"the status is what a report link has to carry",
		);
	});

	it("marks nothing rather than everything once it has failed", async () => {
		assert.deepEqual(
			await checked("nl", "De vergaderingg gaat over de begrooting."),
			[],
			"the browser's own checker is the one on screen now",
		);
	});
});
