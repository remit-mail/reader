import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { data } from "franc-min/data.js";
import { JSDOM } from "jsdom";
import {
	browserSpellcheckHelp,
	COMPOSE_LANGUAGE_OPTIONS,
	defaultComposeLanguages,
	detectionCodeFor,
	languageChipLabel,
	languageLabel,
	unwrapLanguage,
	wrapWithLanguage,
} from "./compose-language.js";

/** The dictionaries the published image stages, per `REMIT_SPELLCHECK_LANGUAGES`. */
const BUILT = ["en", "en-GB", "nl"];

before(() => {
	const dom = new JSDOM("");
	globalThis.DOMParser = dom.window.DOMParser;
});

describe("detectionCodeFor", () => {
	it("resolves a region through its language", () => {
		assert.equal(detectionCodeFor("en-GB"), "eng");
		assert.equal(detectionCodeFor("nl"), "nld");
	});

	it("declines a language nothing can detect", () => {
		assert.equal(detectionCodeFor("ja"), null);
	});
});

describe("languageChipLabel", () => {
	it("drops the region", () => {
		assert.equal(languageChipLabel("en-GB"), "EN");
	});
});

describe("languageLabel", () => {
	it("names a language in its own words", () => {
		assert.equal(languageLabel("nl"), "Nederlands");
		assert.equal(languageLabel("de"), "Deutsch");
	});

	it("falls back to the tag the platform cannot name", () => {
		assert.equal(languageLabel("qq"), "qq");
	});

	it("does not throw on a tag a hand-edited setting could hold", () => {
		assert.equal(languageLabel("not a tag"), "not a tag");
		assert.equal(languageLabel(""), "");
	});
});

describe("defaultComposeLanguages", () => {
	it("follows the browser and always offers a second row", () => {
		assert.deepEqual(defaultComposeLanguages(["nl-NL", "nl", "en-US"]), [
			"nl",
			"en",
		]);
	});

	it("skips a language detection has no table for", () => {
		assert.deepEqual(defaultComposeLanguages(["ja-JP", "de-DE"]), ["de", "en"]);
	});

	it("falls back to English when the browser offers nothing usable", () => {
		assert.deepEqual(defaultComposeLanguages([]), ["en"]);
	});

	it("offers what the build can spellcheck, not the browser alone", () => {
		assert.deepEqual(defaultComposeLanguages(["en-US", "en"], BUILT), [
			"en",
			"nl",
		]);
	});

	it("keeps the browser's own language first, so it stays the default", () => {
		assert.deepEqual(defaultComposeLanguages(["nl-NL", "nl"], BUILT), [
			"nl",
			"en",
		]);
	});
});

describe("browserSpellcheckHelp", () => {
	it("names the setting Chrome keeps it under", () => {
		const help = browserSpellcheckHelp(
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		);
		assert.match(help, /^Chrome checks every language/);
	});

	it("names macOS for Safari, not Chrome", () => {
		const help = browserSpellcheckHelp(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
		);
		assert.match(help, /^macOS decides this/);
	});

	it("tells a Firefox user the setting is actually used", () => {
		const help = browserSpellcheckHelp(
			"Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
		);
		assert.match(help, /^Firefox uses this setting/);
	});

	it("names the keyboard on iOS, where every engine is WebKit", () => {
		const help = browserSpellcheckHelp(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
		);
		assert.match(help, /^On iPhone and iPad the keyboard/);
	});

	it("never claims the app changes the dictionary", () => {
		for (const agent of ["Chrome/141", "Firefox/130", "Safari/605", "curl/8"]) {
			assert.doesNotMatch(browserSpellcheckHelp(agent), /this app|we /i);
		}
	});
});

describe("wrapWithLanguage", () => {
	it("puts the document under one tagged div", () => {
		assert.equal(
			wrapWithLanguage("<p>Hoi</p>", "nl"),
			'<div lang="nl"><p>Hoi</p></div>',
		);
	});

	it("leaves an empty document empty", () => {
		assert.equal(wrapWithLanguage("", "nl"), "");
	});

	it("replaces the tag instead of nesting a second wrapper", () => {
		const once = wrapWithLanguage("<p>Hoi</p>", "nl");
		const twice = wrapWithLanguage(once, "de");
		assert.equal(twice, '<div lang="de"><p>Hoi</p></div>');
		assert.equal(wrapWithLanguage(twice, "de"), twice);
	});

	it("does not adopt a plain div the message happens to start with", () => {
		const wrapped = wrapWithLanguage("<div>Hoi</div>", "nl");
		assert.equal(wrapped, '<div lang="nl"><div>Hoi</div></div>');
	});

	it("cannot be talked out of the attribute by a hand-edited tag", () => {
		const hostile = 'nl"><script>alert(1)</script><div lang="nl';
		const parsed = new DOMParser().parseFromString(
			wrapWithLanguage("<p>Hoi</p>", hostile),
			"text/html",
		);
		assert.equal(parsed.querySelectorAll("script").length, 0);
		assert.equal(parsed.body.children.length, 1);
		assert.equal(parsed.body.children[0]?.getAttribute("lang"), hostile);
	});
});

describe("unwrapLanguage", () => {
	it("returns the document the editor should reopen on", () => {
		assert.deepEqual(unwrapLanguage('<div lang="nl"><p>Hoi</p></div>'), {
			html: "<p>Hoi</p>",
			language: "nl",
		});
	});

	it("leaves an untagged document alone", () => {
		assert.deepEqual(unwrapLanguage("<p>Hoi</p>"), {
			html: "<p>Hoi</p>",
			language: null,
		});
	});

	it("keeps a tagged passage that is not the whole message", () => {
		const html = '<p>Hoi</p><p lang="fr">Bonjour</p>';
		assert.deepEqual(unwrapLanguage(html), { html, language: null });
	});

	it("round-trips what the wrapper wrote", () => {
		const html = '<p>Hoi</p><p lang="fr">Bonjour</p>';
		assert.deepEqual(unwrapLanguage(wrapWithLanguage(html, "nl")), {
			html,
			language: "nl",
		});
	});
});

describe("COMPOSE_LANGUAGE_OPTIONS", () => {
	it("offers no tag twice", () => {
		const tags = COMPOSE_LANGUAGE_OPTIONS.map((option) => option.tag);
		assert.equal(new Set(tags).size, tags.length);
	});

	/**
	 * Read against `franc-min`'s own trigram tables rather than against the list
	 * that produced them: a code the detector has never heard of is a menu row
	 * that can be picked by hand and never detected, and a table built the same
	 * way as the list would agree with it and prove nothing.
	 */
	it("offers only languages the detector has a table for", () => {
		const known = new Set(
			Object.values(data).flatMap((byLanguage) => Object.keys(byLanguage)),
		);
		const unknown = COMPOSE_LANGUAGE_OPTIONS.filter(
			(option) => !known.has(option.detectionCode),
		);
		assert.deepEqual(unknown, []);
	});
});
