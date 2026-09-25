export interface AuthenticationResult {
	method: string;
	result: string;
	properties: ReadonlyMap<string, string>;
}

export interface AuthenticationResults {
	authservId: string;
	results: AuthenticationResult[];
}

type Token =
	| { kind: "word"; text: string }
	| { kind: "quoted"; text: string }
	| { kind: "semicolon" }
	| { kind: "equals" };

type ValueToken = Extract<Token, { kind: "word" | "quoted" }>;

const DELIMITERS = new Set([";", "=", "(", ")", '"']);
const KEYWORD = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const METHOD = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[0-9]+)?$/;
const PROPERTY_KEY =
	/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?$/;
const VERSION = /^[0-9]+$/;

const isWhitespace = (c: string): boolean =>
	c === " " || c === "\t" || c === "\r" || c === "\n";

const skipComment = (input: string, start: number): number | null => {
	let depth = 0;
	for (let i = start; i < input.length; i++) {
		const c = input[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "(") depth++;
		if (c === ")") depth--;
		if (depth === 0) return i + 1;
	}
	return null;
};

const readQuoted = (
	input: string,
	start: number,
): { text: string; end: number } | null => {
	let text = "";
	for (let i = start + 1; i < input.length; i++) {
		const c = input[i];
		if (c === "\\") {
			if (i + 1 >= input.length) return null;
			text += input[i + 1];
			i++;
			continue;
		}
		if (c === '"') return { text, end: i + 1 };
		text += c;
	}
	return null;
};

const tokenize = (input: string): Token[] | null => {
	const tokens: Token[] = [];
	let i = 0;
	while (i < input.length) {
		const c = input[i];
		if (isWhitespace(c)) {
			i++;
			continue;
		}
		if (c === "(") {
			const end = skipComment(input, i);
			if (end === null) return null;
			i = end;
			continue;
		}
		if (c === ")") return null;
		if (c === ";") {
			tokens.push({ kind: "semicolon" });
			i++;
			continue;
		}
		if (c === "=") {
			tokens.push({ kind: "equals" });
			i++;
			continue;
		}
		if (c === '"') {
			const quoted = readQuoted(input, i);
			if (!quoted) return null;
			tokens.push({ kind: "quoted", text: quoted.text });
			i = quoted.end;
			continue;
		}
		let end = i;
		while (
			end < input.length &&
			!isWhitespace(input[end]) &&
			!DELIMITERS.has(input[end])
		) {
			end++;
		}
		tokens.push({ kind: "word", text: input.slice(i, end) });
		i = end;
	}
	return tokens;
};

const splitStatements = (tokens: Token[]): Token[][] => {
	const statements: Token[][] = [[]];
	for (const token of tokens) {
		if (token.kind === "semicolon") {
			statements.push([]);
			continue;
		}
		statements[statements.length - 1].push(token);
	}
	return statements;
};

const isValue = (token: Token | undefined): token is ValueToken =>
	token !== undefined && (token.kind === "word" || token.kind === "quoted");

const joinsKey = (previous: string, next: string): boolean =>
	previous.endsWith(".") ||
	previous.endsWith("/") ||
	next.startsWith(".") ||
	next.startsWith("/");

const readPairs = (statement: Token[]): [string, ValueToken][] | null => {
	const pairs: [string, ValueToken][] = [];
	let key: string[] = [];
	for (let i = 0; i < statement.length; i++) {
		const token = statement[i];
		if (token.kind === "equals") {
			const value = statement[i + 1];
			if (key.length === 0 || !isValue(value)) return null;
			pairs.push([key.join("").toLowerCase(), value]);
			key = [];
			i++;
			continue;
		}
		if (token.kind !== "word") return null;
		const previous = key[key.length - 1];
		if (previous !== undefined && !joinsKey(previous, token.text)) return null;
		key.push(token.text);
	}
	if (key.length > 0) return null;
	return pairs;
};

const parseResult = (statement: Token[]): AuthenticationResult | null => {
	const pairs = readPairs(statement);
	if (!pairs || pairs.length === 0) return null;
	const [[methodKey, resultToken], ...rest] = pairs;
	if (!METHOD.test(methodKey)) return null;
	if (resultToken.kind !== "word") return null;
	const result = resultToken.text.toLowerCase();
	if (!KEYWORD.test(result)) return null;

	const properties = new Map<string, string>();
	for (const [key, value] of rest) {
		if (!PROPERTY_KEY.test(key)) return null;
		if (!properties.has(key)) properties.set(key, value.text);
	}
	return { method: methodKey.split("/")[0], result, properties };
};

const parseAuthservId = (statement: Token[]): string | null => {
	const [id, version, ...extra] = statement;
	if (!isValue(id) || extra.length > 0) return null;
	if (version !== undefined) {
		if (version.kind !== "word" || !VERSION.test(version.text)) return null;
	}
	const authservId = id.text.toLowerCase();
	return authservId.length > 0 ? authservId : null;
};

const isNoResult = (statement: Token[]): boolean =>
	statement.length === 1 &&
	statement[0].kind === "word" &&
	statement[0].text.toLowerCase() === "none";

export const parseAuthenticationResults = (
	value: string,
): AuthenticationResults | null => {
	const tokens = tokenize(value);
	if (!tokens) return null;

	const [head, ...tail] = splitStatements(tokens);
	const headIsResult = head.some((token) => token.kind === "equals");
	const authservId = headIsResult ? "" : parseAuthservId(head);
	if (authservId === null) return null;

	const statements = (headIsResult ? [head, ...tail] : tail).filter(
		(statement) => statement.length > 0,
	);
	if (statements.length === 0) return null;
	if (statements.length === 1 && isNoResult(statements[0])) {
		return { authservId, results: [] };
	}

	const results: AuthenticationResult[] = [];
	for (const statement of statements) {
		const result = parseResult(statement);
		if (!result) return null;
		results.push(result);
	}
	return { authservId, results };
};
