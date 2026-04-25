const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const firstGrapheme = (input: string): string => {
	for (const { segment } of SEGMENTER.segment(input)) {
		const trimmed = segment.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return "";
};

const splitWords = (input: string): string[] =>
	input
		.trim()
		.split(/[\s.,_-]+/u)
		.filter((part) => part.length > 0);

export const computeInitials = (name?: string, email?: string): string => {
	const cleanName = name?.trim();
	if (cleanName) {
		const words = splitWords(cleanName);
		if (words.length === 0) return "?";
		if (words.length === 1) {
			const word = words[0];
			const segments = Array.from(SEGMENTER.segment(word));
			if (segments.length >= 2) {
				return (segments[0].segment + segments[1].segment).toUpperCase();
			}
			return segments[0].segment.toUpperCase();
		}
		const first = firstGrapheme(words[0]);
		const last = firstGrapheme(words[words.length - 1]);
		return (first + last).toUpperCase();
	}
	if (email) {
		const localPart = email.split("@")[0] ?? "";
		const segments = Array.from(SEGMENTER.segment(localPart)).filter(
			(s) => s.segment.trim().length > 0,
		);
		if (segments.length === 0) return "?";
		if (segments.length === 1) return segments[0].segment.toUpperCase();
		return (segments[0].segment + segments[1].segment).toUpperCase();
	}
	return "?";
};

// FNV-1a-style hash. Operates on UTF-16 code units, which is sufficient
// for stable bucketing into the palette below; we don't need cryptographic
// quality, only deterministic + well-distributed output.
const hashKey = (input: string): number => {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

// Palette chosen so white foreground text passes WCAG AA (>=4.5:1)
// against each background color. Tailwind 600/700 shades.
export const AVATAR_PALETTE = [
	"bg-red-600",
	"bg-amber-700",
	"bg-emerald-700",
	"bg-sky-700",
	"bg-violet-600",
	"bg-fuchsia-700",
	"bg-rose-600",
	"bg-cyan-700",
] as const;

export const computeColorClass = (name?: string, email?: string): string => {
	const key = (email || name || "").trim().toLowerCase();
	if (key.length === 0) return AVATAR_PALETTE[0];
	const index = hashKey(key) % AVATAR_PALETTE.length;
	return AVATAR_PALETTE[index];
};
