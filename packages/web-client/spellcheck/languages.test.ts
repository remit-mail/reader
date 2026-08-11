/**
 * The switch, at the point where a self-hoster's `REMIT_SPELLCHECK_LANGUAGES`
 * becomes the set the image carries. Everything downstream — the staged files,
 * the manifest, NOTICE.txt, and what the composer believes it can check — is
 * that set and nothing else, so a wrong answer here is wrong everywhere at once.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_SPELLCHECK_LANGUAGES,
	DICTIONARY_SOURCES,
	resolveLanguages,
} from "./languages.ts";

const tagsOf = (requested: string | undefined): readonly string[] =>
	resolveLanguages(requested).map((source) => source.tag);

const thrownBy = (work: () => unknown): Error => {
	try {
		work();
	} catch (error) {
		return error as Error;
	}
	throw new Error("nothing was thrown");
};

describe("the language set an image is built with", () => {
	it("carries the published default when nothing is asked for", () => {
		assert.deepEqual(tagsOf(undefined), DEFAULT_SPELLCHECK_LANGUAGES.split(","));
	});

	// `defaultComposeLanguages` appends `en` to every account, so an image
	// without it would leave the one language every account offers as the one
	// language it cannot check.
	it("carries English whether or not it was asked for", () => {
		assert.deepEqual(tagsOf("nl"), ["en", "nl"]);
		assert.equal(tagsOf("en,nl")[0], "en");
	});

	it("reads a tag the same however it was typed, and carries it once", () => {
		assert.deepEqual(tagsOf(" nl , EN-gb ,nl, en "), ["en", "nl", "en-GB"]);
	});

	// The self-hoster's opt-out. An empty list is a legitimate answer and not a
	// typo to be corrected into the default, so it does not acquire English.
	it("carries nothing at all when the list is empty", () => {
		assert.deepEqual(tagsOf(""), []);
		assert.deepEqual(tagsOf("  "), []);
		assert.deepEqual(tagsOf(",, ,"), []);
	});

	it("hands back the whole row, not just the tag", () => {
		const [english] = resolveLanguages("en");
		assert.equal(english.package, "dictionary-en");
		assert.ok(english.licence.length > 0);
		assert.ok(english.source.startsWith("https://"));
	});

	// A tag nobody can ship must stop the build rather than quietly produce an
	// image whose NOTICE.txt is a list of what the operator asked for.
	it("stops on a tag no dictionary covers, and says which one", () => {
		const failed = thrownBy(() => resolveLanguages("en,nl,fi"));
		assert.match(failed.message, /"fi"/);
		assert.match(failed.message, /packages\/web-client\/spellcheck\/languages/);
		// The remedy is picking a known tag, so the message has to list them.
		for (const source of DICTIONARY_SOURCES) {
			assert.ok(
				failed.message.includes(source.tag),
				`the failure does not offer ${source.tag}`,
			);
		}
	});

	it("stops on an unknown tag even when every other tag is known", () => {
		assert.throws(() => resolveLanguages("nl,de"), /"de"/);
	});
});
