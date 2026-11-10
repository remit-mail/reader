export interface ClassifierHeader {
	name: string;
	value: string;
}

export interface ClassifierMessage {
	headers: readonly ClassifierHeader[];
	text: string;
}

const BODY_WORD_LIMIT = 1_500;

const SENT_HEADERS = new Set([
	"from",
	"to",
	"subject",
	"date",
	"authentication-results",
]);

const isSentHeader = (name: string): boolean => {
	const lower = name.toLowerCase();
	return SENT_HEADERS.has(lower) || lower.startsWith("list-");
};

const bodySlice = (text: string): string => {
	let end = 0;
	let count = 0;
	for (const word of text.matchAll(/\S+/g)) {
		if (count === BODY_WORD_LIMIT) break;
		end = word.index + word[0].length;
		count++;
	}
	return text.slice(0, end);
};

export const countWords = (text: string): number =>
	text.match(/\S+/g)?.length ?? 0;

export const classifierRequestText = (message: ClassifierMessage): string => {
	const headerLines = message.headers
		.filter((header) => isSentHeader(header.name))
		.map((header) => `${header.name}: ${header.value}`);
	return `${headerLines.join("\n")}\n\n${bodySlice(message.text)}`;
};
