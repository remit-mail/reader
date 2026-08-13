/**
 * The language of a message a Dutch writer types on an English browser, all the
 * way through the surface: the chip, the tag on the writing surface, and the
 * dictionary the checker is opened for.
 *
 * The account that has never been to the language setting is the ordinary case,
 * and what it falls back on has to be a set detection can choose inside — a set
 * of one is detection switched off, and the message then goes out tagged `en`
 * with every Dutch word underlined.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultComposeLanguages } from "../lib/compose-language.js";
import { ComposeBody } from "./compose-body.js";
import type {
	SpellcheckOptions,
	SpellProvider,
} from "./rich-text-spellcheck.js";

let container: HTMLElement;
let root: Root;

/** What the published image stages, per `REMIT_SPELLCHECK_LANGUAGES`. */
const BUILT = ["en", "en-GB", "nl"];

/** An English browser, which is what a Dutch writer routinely reads mail on. */
const BROWSER = ["en-US", "en"];

const DUTCH = "OK nou dank je wel hoor flapsigaar";

class Marks {
	readonly ranges: Range[] = [];
	add(range: Range): void {
		this.ranges.push(range);
	}
}

const recordingSpellcheck = (): {
	options: SpellcheckOptions;
	asked: string[];
} => {
	const asked: string[] = [];
	const options: SpellcheckOptions = {
		provider: (language) => {
			asked.push(language);
			const provider: SpellProvider = {
				language,
				onStatus: (listener) => {
					listener({ state: "ready", language });
					return () => {};
				},
				check: (request) =>
					Promise.resolve({
						requestId: request.requestId,
						revision: request.revision,
						findings: [],
					}),
				suggest: (request) =>
					Promise.resolve({
						requestId: request.requestId,
						word: request.word,
						suggestions: [],
					}),
				close: () => {},
			};
			return Promise.resolve(provider);
		},
	};
	return { options, asked };
};

const settle = async (): Promise<void> => {
	await act(async () => {
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
	});
};

/** Past the detection debounce, which is what the chip waits on. */
const detected = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 600));
	});
	await settle();
};

const editable = (): HTMLElement => {
	const surface = container.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!surface) throw new Error("the writing surface is not mounted");
	return surface;
};

const chip = (): HTMLElement => {
	const control = container.querySelector<HTMLElement>(
		"[data-testid=compose-language-chip]",
	);
	if (!control) throw new Error("the language chip is not mounted");
	return control;
};

before(() => {
	// The marks are drawn through the CSS Custom Highlight registry, which jsdom
	// has neither half of, and without it no checker is opened at all.
	Object.defineProperty(globalThis, "CSS", {
		value: { highlights: new Map<string, Marks>() },
		configurable: true,
	});
	Object.defineProperty(globalThis, "Highlight", {
		value: Marks,
		configurable: true,
	});
});

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
});

const mount = async (
	text: string,
	languages: readonly string[],
	spellcheck?: SpellcheckOptions,
): Promise<void> => {
	await act(async () => {
		root = createRoot(container);
		root.render(
			createElement(ComposeBody, {
				mode: "rich",
				onModeChange: () => undefined,
				initialHtml: `<p>${text}</p>`,
				initialText: text,
				onChange: () => undefined,
				onConversionError: () => undefined,
				onLanguageChange: () => undefined,
				languages,
				spellcheck,
			}),
		);
	});
	await settle();
};

describe("the language a message is written in", () => {
	it("reads Dutch off the body of an account that never chose a language", async () => {
		const { options, asked } = recordingSpellcheck();

		await mount(DUTCH, defaultComposeLanguages(BROWSER, BUILT), options);
		await detected();

		assert.equal(chip().dataset.language, "nl");
		assert.equal(chip().dataset.languageSource, "detected");
		assert.equal(chip().textContent, "NL");
		assert.equal(editable().getAttribute("lang"), "nl");
		assert.equal(
			asked.at(-1),
			"nl",
			"the checker follows the language, so the underlines are Dutch ones",
		);
	});

	it("stays on the account default while the body is English", async () => {
		await mount(
			"Thanks a lot, I will send you a new proposal tomorrow.",
			defaultComposeLanguages(BROWSER, BUILT),
		);
		await detected();

		assert.equal(chip().dataset.language, "en");
		assert.equal(editable().getAttribute("lang"), "en");
	});
});
