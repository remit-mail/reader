import { CodeHighlightNode, CodeNode } from "@lexical/code-core";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { EditorThemeClasses, Klass, LexicalNode } from "lexical";

/**
 * Lexical maps a pasted element only to a node type the editor has registered;
 * anything else collapses to its text. Registering headings, lists, tables,
 * code and rules is what lets adopted structure survive the paste (#671).
 */
export const RICH_TEXT_NODES: ReadonlyArray<Klass<LexicalNode>> = [
	HeadingNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	LinkNode,
	AutoLinkNode,
	TableNode,
	TableRowNode,
	TableCellNode,
	CodeNode,
	CodeHighlightNode,
	HorizontalRuleNode,
];

export const richTextTheme: EditorThemeClasses = {
	code: "block my-2 rounded bg-surface-sunken p-2 font-mono text-xs whitespace-pre-wrap",
	heading: {
		h1: "mt-3 mb-1 text-xl font-semibold",
		h2: "mt-3 mb-1 text-lg font-semibold",
		h3: "mt-2 mb-1 text-base font-semibold",
		h4: "mt-2 mb-1 text-sm font-semibold",
		h5: "mt-2 mb-1 text-sm font-semibold",
		h6: "mt-2 mb-1 text-xs font-semibold uppercase tracking-wide",
	},
	hr: "my-3 border-t border-line",
	link: "text-accent underline",
	list: {
		listitem: "ml-2",
		nested: { listitem: "list-none" },
		ol: "my-1 list-decimal pl-6",
		ul: "my-1 list-disc pl-6",
	},
	paragraph: "my-1",
	quote: "my-1 border-l-2 border-fg-subtle/30 pl-3 text-fg-muted [&_p]:my-0.5",
	table: "my-2 w-full table-fixed border-collapse",
	tableCell: "border border-line px-2 py-1 align-top",
	tableCellHeader: "bg-surface-sunken font-semibold",
	text: {
		bold: "font-semibold",
		code: "rounded bg-surface-sunken px-1 font-mono text-xs",
		italic: "italic",
		strikethrough: "line-through",
		underline: "underline",
	},
};
