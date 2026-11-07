export const REDACTED = "[redacted]";

// Matched against the key lowercased with every non-alphanumeric dropped, so
// `access_token`, `Access-Token` and `accessToken` all end in `token`, while
// `tokenCount` ends in `count` and stays.
const SECRET_SUFFIXES = [
	"password",
	"passwd",
	"secret",
	"token",
	"authorization",
	"cookie",
	"apikey",
] as const;

export const isSecretKey = (key: string): boolean => {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
	return SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

const hasToJson = (value: object): boolean =>
	typeof (value as { toJSON?: unknown }).toJSON === "function";

/**
 * A copy of `value` with the value of every secret-named key, at any depth,
 * replaced by `"[redacted]"`. Walks arrays and the own enumerable keys of
 * objects, the same keys JSON.stringify writes; an object with `toJSON` is
 * left whole. A cycle in the input stays a cycle in the copy.
 */
export const redact = (value: unknown): unknown => {
	const copies = new WeakMap<object, unknown>();

	const walk = (current: unknown): unknown => {
		if (typeof current !== "object" || current === null) return current;
		if (hasToJson(current)) return current;
		const seen = copies.get(current);
		if (seen !== undefined) return seen;

		if (Array.isArray(current)) {
			const copy: unknown[] = [];
			copies.set(current, copy);
			for (const item of current) copy.push(walk(item));
			return copy;
		}

		const copy: Record<string, unknown> = {};
		copies.set(current, copy);
		for (const [key, item] of Object.entries(current)) {
			copy[key] = isSecretKey(key) ? REDACTED : walk(item);
		}
		return copy;
	};

	return walk(value);
};
