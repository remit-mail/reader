/**
 * How the address bar spells the query string.
 *
 * The router's own serializer writes one param per key, so a list of values
 * comes out as a JSON blob — `?calendarId=%5B%22cal_a%22%2C%22cal_b%22%5D`. A
 * list of values is what a query string has always been able to say, and
 * saying it the ordinary way is what makes a link hand-writable, readable in a
 * log, and usable by anything that is not this router. The router's own reader
 * already collects repeated params into an array, so only the writing side was
 * missing.
 *
 * Every other value keeps the spelling the router already gives it, including
 * the quoting that text reading as JSON needs: the reader JSON-parses whatever
 * it can, so `?q=true` would come back the boolean unless the string went in
 * quoted.
 */

/**
 * Whether reading this text back would produce something other than the text.
 *
 * Decided by shape rather than by parsing it, because a block try/catch is not
 * available and an over-quoted string still reads back as itself — the reader
 * unquotes it — where an under-quoted one comes back the wrong type.
 */
const readsAsJson = (value: string): boolean =>
	value === "true" ||
	value === "false" ||
	value === "null" ||
	/^["[{]/.test(value) ||
	(value !== "" && Number.isFinite(Number(value)));

/** The router's own value spelling. */
function stringifyValue(value: unknown): string {
	if (typeof value === "object" && value !== null) return JSON.stringify(value);
	if (typeof value === "string")
		return readsAsJson(value) ? JSON.stringify(value) : value;
	return String(value);
}

/**
 * A query string, with a list written as the repeated params it is.
 *
 * `undefined` is absent rather than empty: a fact the view has nothing to say
 * about does not belong in the address at all.
 */
export function stringifySearch(search: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const key of Object.keys(search)) {
		const value = search[key];
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const entry of value) params.append(key, stringifyValue(entry));
			continue;
		}
		params.set(key, stringifyValue(value));
	}
	const written = params.toString();
	return written === "" ? "" : `?${written}`;
}
