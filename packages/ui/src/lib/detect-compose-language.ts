import { franc } from "franc-min";
import { detectionCodeFor } from "./compose-language.js";

/**
 * Below this, detection is a coin toss — `franc-min` scores 90.7% at 20 to 45
 * characters and drops off a cliff under that. A greeting line holds the
 * account default instead.
 */
export const DETECTION_MIN_LENGTH = 20;

/**
 * The language of a body, chosen inside the account's own candidate set.
 *
 * The restriction is what makes a 53 kB trigram table good enough: `franc`
 * scores 87.1% on one sentence over all 414 languages and 97.3% over six.
 * Returns null when the text is too short, when there is nothing to choose
 * between, or when the detector declines to answer.
 *
 * Kept apart from the hook that calls it so `franc-min` stays out of every
 * chunk that only wants a language tag, and so this is testable as the pure
 * function it is.
 */
export const detectComposeLanguage = (
	text: string,
	candidates: readonly string[],
): string | null => {
	const trimmed = text.trim();
	if (trimmed.length < DETECTION_MIN_LENGTH) return null;

	const tagByCode = new Map<string, string>();
	for (const tag of candidates) {
		const code = detectionCodeFor(tag);
		if (code && !tagByCode.has(code)) tagByCode.set(code, tag);
	}
	if (tagByCode.size < 2) return null;

	const detected = franc(trimmed, {
		only: [...tagByCode.keys()],
		minLength: DETECTION_MIN_LENGTH,
	});
	return tagByCode.get(detected) ?? null;
};
