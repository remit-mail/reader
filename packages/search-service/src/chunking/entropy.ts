import type { Chunk } from "../types.js";

const SIGNATURE_MARKERS: RegExp[] = [
	/^--\s*$/m,
	/^Best regards/im,
	/^Best,/im,
	/^Regards,/im,
	/^Kind regards/im,
	/^Thanks,/im,
	/^Cheers,/im,
	/^Sent from my (iPhone|iPad|Android|Samsung)/im,
];

const QUOTE_MARKERS: RegExp[] = [
	/^>/m,
	/^On .+ wrote:$/im,
	/^-{3,}\s*Original Message\s*-{3,}$/im,
	/^_{3,}$/m,
	/^From:.*Sent:.*To:/im,
];

const stripQuoted = (text: string): string => {
	const lines = text.split("\n");
	const result: string[] = [];
	for (const line of lines) {
		let isQuoted = false;
		for (const re of QUOTE_MARKERS) {
			if (re.test(line)) {
				isQuoted = true;
				break;
			}
		}
		if (isQuoted) break;
		result.push(line);
	}
	return result.join("\n");
};

const stripSignature = (text: string): string => {
	let earliest = text.length;
	for (const re of SIGNATURE_MARKERS) {
		const match = re.exec(text);
		if (match && match.index < earliest) {
			earliest = match.index;
		}
	}
	return text.slice(0, earliest).trim();
};

export const stripBoilerplate = (text: string): string => {
	return stripSignature(stripQuoted(text));
};

export const shannonEntropy = (text: string): number => {
	if (text.length === 0) return 0;
	const counts = new Map<string, number>();
	for (const ch of text) {
		counts.set(ch, (counts.get(ch) ?? 0) + 1);
	}
	let entropy = 0;
	const len = text.length;
	for (const c of counts.values()) {
		const p = c / len;
		entropy -= p * Math.log2(p);
	}
	return entropy;
};

const MIN_CHUNK_CHARS = 80;
const MAX_CHUNK_CHARS = 2000;
const ENTROPY_THRESHOLD = 3.5;
const WINDOW_SIZE = 100;

/**
 * Hard ceiling for any chunk text handed to the embedder. Titan v2
 * (amazon.titan-embed-text-v2:0) rejects inputs over 8192 tokens; 6000 chars
 * stays comfortably under that even for dense, low-whitespace text.
 */
export const EMBED_CHAR_BUDGET = 6000;

const splitParagraphs = (text: string): string[] => {
	return text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
};

const mergeUntilCap = (paragraphs: string[]): string[] => {
	const merged: string[] = [];
	let current = "";
	for (const p of paragraphs) {
		if (current.length === 0) {
			current = p;
			continue;
		}
		if (current.length + p.length + 2 <= MAX_CHUNK_CHARS) {
			current = `${current}\n\n${p}`;
			continue;
		}
		merged.push(current);
		current = p;
	}
	if (current.length > 0) merged.push(current);
	return merged;
};

const isHighEntropy = (text: string): boolean => {
	if (text.length < WINDOW_SIZE) {
		return shannonEntropy(text) >= ENTROPY_THRESHOLD;
	}
	let maxEntropy = 0;
	for (let i = 0; i + WINDOW_SIZE <= text.length; i += WINDOW_SIZE) {
		const window = text.slice(i, i + WINDOW_SIZE);
		const e = shannonEntropy(window);
		if (e > maxEntropy) maxEntropy = e;
	}
	return maxEntropy >= ENTROPY_THRESHOLD;
};

export const splitToCharBudget = (text: string, budget: number): string[] => {
	if (text.length <= budget) return [text];
	const parts: string[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		parts.push(text.slice(cursor, cursor + budget));
		cursor += budget;
	}
	return parts;
};

const splitOversized = (text: string): string[] =>
	splitToCharBudget(text, MAX_CHUNK_CHARS);

export const buildBodyChunks = (
	text: string,
	chunkIdFor: (suffix: string) => string,
): Chunk[] => {
	const stripped = stripBoilerplate(text);
	if (stripped.length < MIN_CHUNK_CHARS) return [];

	const paragraphs = splitParagraphs(stripped);
	const informative = paragraphs.filter(isHighEntropy);
	if (informative.length === 0) return [];

	const merged = mergeUntilCap(informative);
	const final: string[] = [];
	for (const m of merged) {
		for (const part of splitOversized(m)) {
			if (part.length >= MIN_CHUNK_CHARS) final.push(part);
		}
	}

	return final.map((textChunk, idx) => ({
		chunkId: chunkIdFor(`body-${idx}`),
		chunkType: "body",
		text: textChunk,
	}));
};
