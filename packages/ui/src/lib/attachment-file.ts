/**
 * Filename and size presentation for a mail attachment.
 *
 * An attachment filename is attacker-controlled: it arrives verbatim in a
 * `Content-Disposition` header written by whoever sent the mail. Two things
 * downstream trust it — the browser's save dialog (`<a download>`) and the
 * rendered list — so one sanitizer serves both. What the list shows is exactly
 * what the file is saved as; a name that reads one way and saves another is the
 * whole point of the attack.
 */

/**
 * Control characters, zero-width joiners, line/paragraph separators and the
 * bidirectional overrides. A RIGHT-TO-LEFT OVERRIDE placed inside
 * `report<RLO>gnp.exe` makes it render as `reportexe.png`: the extension a
 * user reads is not the extension that executes. Stripping rather than
 * escaping keeps the displayed name and the saved name identical.
 */
const INVISIBLE_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0/C1 controls out of an attacker-supplied filename is the point
	/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Illegal in a Windows path, and `:` is a separator on classic macOS. */
const UNSAFE_CHARACTERS = /[<>:"|?*]/g;

/** Reserved device names on Windows — saving to one has no defined outcome. */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

const MAX_FILENAME_LENGTH = 120;
const MAX_EXTENSION_LENGTH = 12;

export const DEFAULT_ATTACHMENT_FILENAME = "attachment";

const clampLength = (name: string): string => {
	// Code points, not UTF-16 units: slicing units splits a surrogate pair and
	// leaves a lone half in the saved name.
	const characters = [...name];
	if (characters.length <= MAX_FILENAME_LENGTH) return name;
	const dot = name.lastIndexOf(".");
	const extension =
		dot > 0 && [...name.slice(dot)].length <= MAX_EXTENSION_LENGTH
			? name.slice(dot)
			: "";
	const budget = MAX_FILENAME_LENGTH - [...extension].length;
	return characters.slice(0, budget).join("") + extension;
};

/**
 * Reduce an attacker-supplied attachment filename to a name that is safe to
 * both display and save: the final path segment only, no invisible characters,
 * no leading dot (a hidden file the user never sees land), and bounded length.
 * Falls back to `fallback` when nothing usable survives.
 */
export const sanitizeAttachmentFilename = (
	raw: string,
	fallback: string = DEFAULT_ATTACHMENT_FILENAME,
): string => {
	const visible = raw.replace(INVISIBLE_CHARACTERS, "");
	const segments = visible.split(/[/\\]/);
	const basename = segments[segments.length - 1] ?? "";
	const trimmed = basename
		.replace(UNSAFE_CHARACTERS, "_")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");
	if (trimmed.length === 0) return clampLength(fallback);
	const guarded = RESERVED_DEVICE_NAME.test(trimmed) ? `_${trimmed}` : trimmed;
	return clampLength(guarded);
};

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/**
 * Human-readable byte size, 1024-based, at most one decimal. A negative or
 * non-finite size reads as unknown rather than as a number, so a broken
 * BODYSTRUCTURE never presents itself as a measurement.
 *
 * The promotion threshold is the point where one decimal would round up to
 * `1024`, not `1024` itself — `1048570 B` is `1 MB`, never `1024 KB`.
 */
export const formatByteSize = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
	const octets = Math.round(bytes);
	if (octets < 1024) return octets === 1 ? "1 byte" : `${octets} bytes`;

	const promoteAt = 1023.95;
	let value = octets / 1024;
	let unit = 0;
	while (value >= promoteAt && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const rendered = value.toFixed(1).replace(/\.0$/, "");
	return `${rendered} ${SIZE_UNITS[unit]}`;
};
