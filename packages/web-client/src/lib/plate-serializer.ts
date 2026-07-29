import type { TElement, TText, Value } from "platejs";

type PlateNode = TElement | TText;

const isText = (node: PlateNode): node is TText =>
	"text" in node && !("children" in node);

const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const serializeTextNode = (node: TText): string => {
	let html = escapeHtml(node.text);
	if (node.bold) html = `<strong>${html}</strong>`;
	if (node.italic) html = `<em>${html}</em>`;
	return html;
};

const serializeElement = (node: TElement): string => {
	const children = node.children
		.map((child) =>
			isText(child as PlateNode)
				? serializeTextNode(child as TText)
				: serializeElement(child as TElement),
		)
		.join("");

	switch (node.type) {
		case "blockquote":
			return `<blockquote>${children}</blockquote>`;
		case "a": {
			const url = (node as TElement & { url?: string }).url ?? "";
			return `<a href="${escapeHtml(url)}">${children}</a>`;
		}
		default:
			return `<p>${children}</p>`;
	}
};

export const plateValueToHtml = (value: Value): string =>
	value.map(serializeElement).join("");

const extractText = (node: PlateNode): string => {
	if (isText(node)) return node.text;
	return (node.children as PlateNode[]).map(extractText).join("");
};

export const plateValueToText = (value: Value): string =>
	value.map(extractText).join("\n");
