/**
 * Whether a token is a position `listByFieldTerms` hands out: base64 JSON of
 * the row's sent date and id. A request carrying one is checked up front, so
 * a malformed position is refused rather than failing the job that reads it.
 */
export const isListPosition = (token: string): boolean => {
	let decoded: unknown;
	try {
		decoded = JSON.parse(atob(token));
	} catch {
		return false;
	}
	return (
		typeof decoded === "object" &&
		decoded !== null &&
		typeof Reflect.get(decoded, "s") === "number" &&
		typeof Reflect.get(decoded, "id") === "string"
	);
};
