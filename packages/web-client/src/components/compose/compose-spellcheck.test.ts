/**
 * What the composer hands the editor (#707): a worker opened for the language
 * the message is being written in, and a failure nobody has to guess at.
 *
 * The two ways checking stops look identical on screen — no squiggles — and
 * mean opposite things. A language with no dictionary is expected, and the
 * browser carries on checking. A checker that was supposed to start and did not
 * is a fault, and it is named on screen with a way to report it.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PushErrorInput } from "../ui/error-banners.js";
import { composeSpellcheck, spellcheckFailure } from "./compose-spellcheck.js";

interface WorkerMessage {
	readonly type: string;
	readonly language?: string;
}

const opened: { url: string; messages: WorkerMessage[] }[] = [];

class FakeWorker {
	readonly messages: WorkerMessage[] = [];
	constructor(url: URL) {
		opened.push({ url: url.href, messages: this.messages });
	}
	postMessage(message: WorkerMessage): void {
		this.messages.push(message);
	}
	addEventListener(): void {}
	terminate(): void {}
}

const withWorker = <T>(run: () => Promise<T>): Promise<T> => {
	Object.defineProperty(globalThis, "Worker", {
		value: FakeWorker,
		configurable: true,
	});
	return run();
};

afterEach(() => {
	opened.length = 0;
});

describe("the checker the composer opens", () => {
	it("asks the worker for the language the message is in", async () => {
		const provider = await withWorker(() =>
			composeSpellcheck(() => undefined).provider("en"),
		);

		assert.equal(provider?.language, "en");
		assert.equal(opened.length, 1);
		assert.match(opened[0].url, /rich-text-spellcheck-worker/);
		assert.deepEqual(opened[0].messages, [{ type: "open", language: "en" }]);
		provider?.close();
	});

	it("starts no worker for a language the build carries no words for", async () => {
		const provider = await withWorker(() =>
			composeSpellcheck(() => undefined).provider("nl"),
		);

		assert.equal(provider, null);
		assert.deepEqual(opened, []);
	});

	it("reports nothing while the checker is coming up or running", () => {
		const reported: PushErrorInput[] = [];
		const { onStatus } = composeSpellcheck((input) => reported.push(input));

		onStatus?.({ state: "opening", language: "en" });
		onStatus?.({ state: "ready", language: "en" });
		onStatus?.({ state: "unavailable", language: "nl" });

		assert.deepEqual(reported, []);
	});

	it("says what stopped, and offers the report prefilled", () => {
		const reported: PushErrorInput[] = [];
		const { onStatus } = composeSpellcheck((input) => reported.push(input));

		onStatus?.({
			state: "failed",
			language: "en",
			reason: "worker",
			detail: "Worker is not defined",
		});

		assert.equal(reported.length, 1);
		const banner = reported[0];
		assert.match(banner.detail ?? "", /Spellcheck for en is off/);
		assert.match(banner.detail ?? "", /browser is checking this message/);
		assert.match(banner.detail ?? "", /Worker is not defined/);
		assert.match(banner.action?.href ?? "", /github\.com\/.+\/issues\/new\?/);
		assert.match(
			decodeURIComponent(banner.action?.href ?? ""),
			/Worker is not defined/,
		);
	});

	it("names the download and the engine apart from the worker", () => {
		const download = spellcheckFailure({
			state: "failed",
			language: "en",
			reason: "download",
			detail: "404",
		});
		const engine = spellcheckFailure({
			state: "failed",
			language: "en",
			reason: "engine",
			detail: "bad wasm",
		});

		assert.match(download.detail ?? "", /dictionary could not be downloaded/);
		assert.match(engine.detail ?? "", /checker could not start/);
	});
});
