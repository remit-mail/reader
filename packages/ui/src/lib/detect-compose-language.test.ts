/**
 * Detection restricted to the account's own languages. The restriction is the
 * whole reason a 53 kB trigram table is good enough: `franc` scores 87.1% on
 * one sentence over all 414 languages and 97.3% over six.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectComposeLanguage } from "./detect-compose-language.js";

const DUTCH =
	"Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel.";
const ENGLISH =
	"Hi Anna, Thursday's meeting is off. I will send you a new proposal tomorrow.";
const GERMAN =
	"Hallo Anna, die Besprechung am Donnerstag fällt aus. Ich schicke dir morgen einen neuen Vorschlag.";
const FRENCH =
	"Bonjour Anna, la réunion de jeudi est annulée. Je vous enverrai une nouvelle proposition demain.";

const CANDIDATES = ["nl", "en", "de"];

describe("detectComposeLanguage", () => {
	it("picks each candidate out of the others", () => {
		assert.equal(detectComposeLanguage(DUTCH, CANDIDATES), "nl");
		assert.equal(detectComposeLanguage(ENGLISH, CANDIDATES), "en");
		assert.equal(detectComposeLanguage(GERMAN, CANDIDATES), "de");
	});

	it("stays inside the candidate set", () => {
		const detected = detectComposeLanguage(FRENCH, CANDIDATES);
		assert.ok(detected === null || CANDIDATES.includes(detected));
	});

	it("declines a greeting line", () => {
		assert.equal(detectComposeLanguage("Hoi Anna,", CANDIDATES), null);
		assert.equal(detectComposeLanguage("   ", CANDIDATES), null);
	});

	it("declines when there is nothing to choose between", () => {
		assert.equal(detectComposeLanguage(DUTCH, ["nl"]), null);
		assert.equal(detectComposeLanguage(DUTCH, []), null);
	});

	it("ignores a configured language nothing can detect", () => {
		assert.equal(detectComposeLanguage(DUTCH, ["nl", "ja"]), null);
		assert.equal(detectComposeLanguage(DUTCH, ["nl", "ja", "en"]), "nl");
	});

	it("resolves a regional tag through its language", () => {
		assert.equal(detectComposeLanguage(ENGLISH, ["nl", "en-GB"]), "en-GB");
	});
});
