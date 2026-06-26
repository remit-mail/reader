import DOMPurify from "dompurify";

const QUOTE_ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"a",
	"blockquote",
	"ul",
	"ol",
	"li",
];

const QUOTE_ALLOWED_ATTR = ["href"];

export const sanitizeQuoteHtml = (html: string): string =>
	DOMPurify.sanitize(html, {
		ALLOWED_TAGS: QUOTE_ALLOWED_TAGS,
		ALLOWED_ATTR: QUOTE_ALLOWED_ATTR,
	});
