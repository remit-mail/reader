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

const parseTextWithMarks = (
	textContent: string,
	marks: Record<string, boolean>,
): TText => ({
	text: textContent,
	...marks,
});

const getMarksFromElement = (el: Element): Record<string, boolean> => {
	const marks: Record<string, boolean> = {};
	const tag = el.tagName.toLowerCase();
	if (tag === "strong" || tag === "b") marks.bold = true;
	if (tag === "em" || tag === "i") marks.italic = true;
	return marks;
};

const parseInlineChildren = (
	node: Node,
	inheritedMarks: Record<string, boolean> = {},
): TText[] => {
	const results: TText[] = [];

	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			results.push(parseTextWithMarks(child.textContent ?? "", inheritedMarks));
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;

		const el = child as Element;
		const tag = el.tagName.toLowerCase();

		if (tag === "a") {
			const linkElement: TElement & { url: string } = {
				type: "a",
				url: el.getAttribute("href") ?? "",
				children: parseInlineChildren(el, inheritedMarks),
			};
			results.push(linkElement as unknown as TText);
			continue;
		}

		const marks = { ...inheritedMarks, ...getMarksFromElement(el) };
		results.push(...parseInlineChildren(el, marks));
	}

	return results;
};

const parseBlockElement = (el: Element): TElement => {
	const tag = el.tagName.toLowerCase();

	if (tag === "blockquote") {
		const children = Array.from(el.children);
		if (children.length > 0) {
			return {
				type: "blockquote",
				children: children.map(parseBlockElement),
			};
		}
		const inlineChildren = parseInlineChildren(el);
		return {
			type: "blockquote",
			children: inlineChildren.length > 0 ? inlineChildren : [{ text: "" }],
		};
	}

	if (tag === "a") {
		return {
			type: "a",
			url: el.getAttribute("href") ?? "",
			children: parseInlineChildren(el),
		} as TElement & { url: string };
	}

	const inlineChildren = parseInlineChildren(el);
	return {
		type: "p",
		children: inlineChildren.length > 0 ? inlineChildren : [{ text: "" }],
	};
};

export const htmlToPlateValue = (html: string): Value => {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const body = doc.body;

	const blockElements = Array.from(body.childNodes).reduce<TElement[]>(
		(acc, node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent ?? "";
				if (text.trim()) {
					acc.push({ type: "p", children: [{ text }] });
				}
				return acc;
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				acc.push(parseBlockElement(node as Element));
			}
			return acc;
		},
		[],
	);

	if (blockElements.length === 0) {
		return [{ type: "p", children: [{ text: "" }] }];
	}

	return blockElements;
};
