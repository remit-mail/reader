/**
 * A filename arrives from a browser's `File.name` and reaches a
 * `Content-Disposition` header on a message a stranger opens. Nothing in the
 * middle re-derives it, and the storage key never contains it — the key is a
 * generated id — so this is the one place the value is made safe.
 */

const PATH_SEPARATORS = /^.*[\\/]/;

// C0/C1 controls and DEL, then the bidi and directional-isolate formatting
// characters that let a name ending in "exe" render as if it ended in "png".
const UNSAFE_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
	/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const MAX_FILENAME_LENGTH = 200;

// By code point, never by UTF-16 unit: cutting mid-surrogate leaves a lone half
// that a Content-Disposition encoder can only render as U+FFFD.
const truncateCodePoints = (value: string, limit: number): string =>
	Array.from(value).slice(0, limit).join("");

const truncateKeepingExtension = (filename: string): string => {
	const codePoints = Array.from(filename);
	if (codePoints.length <= MAX_FILENAME_LENGTH) return filename;

	const dot = filename.lastIndexOf(".");
	const extension = dot > 0 ? Array.from(filename.slice(dot)) : [];
	if (extension.length === 0 || extension.length > 16) {
		return truncateCodePoints(filename, MAX_FILENAME_LENGTH);
	}
	return (
		truncateCodePoints(filename, MAX_FILENAME_LENGTH - extension.length) +
		extension.join("")
	);
};

/**
 * The filename to record, or null when nothing usable survives — a name made
 * only of separators, dots or control characters is refused rather than
 * replaced with something invented.
 */
export const sanitizeAttachmentFilename = (raw: string): string | null => {
	// Strip first, then take the basename. The other order is bypassable: `.`
	// does not match a newline, so `PATH_SEPARATORS` stops at one and leaves
	// every separator after it — "report\r\n/../../.bashrc" survives with its
	// slashes intact.
	const stripped = raw.replace(UNSAFE_CHARACTERS, "");
	const basename = stripped.replace(PATH_SEPARATORS, "").trim();
	const trimmed = basename.replace(/^\.+/, "").trim();

	if (trimmed.length === 0) return null;

	return truncateKeepingExtension(trimmed);
};

// RFC 9110 token characters, on both sides of the one slash.
const MEDIA_TYPE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export const FALLBACK_CONTENT_TYPE = "application/octet-stream";

// The longest registered media type is well under this. A token run past it is
// a client inventing one, and it would overflow the response field it lands in.
const MAX_CONTENT_TYPE_LENGTH = 127;

/**
 * The media type to record. Parameters (`; charset=…`) are dropped and anything
 * that is not a bare type/subtype becomes the fallback: the value is recorded
 * for the outgoing MIME part, never trusted for rendering.
 */
export const normalizeAttachmentContentType = (raw: string): string => {
	const bare = raw.split(";")[0].trim().toLowerCase();
	if (bare.length > MAX_CONTENT_TYPE_LENGTH) return FALLBACK_CONTENT_TYPE;
	if (!MEDIA_TYPE.test(bare)) return FALLBACK_CONTENT_TYPE;
	return bare;
};
