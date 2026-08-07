import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	type ElementTransformer,
	isTableRowDivider,
	TRANSFORMERS,
	type Transformer,
} from "@lexical/markdown";
import {
	$createTableCellNode,
	$createTableNode,
	$createTableRowNode,
	$isTableCellNode,
	$isTableNode,
	$isTableRowNode,
	TableCellHeaderStates,
	TableCellNode,
	TableNode,
	TableRowNode,
} from "@lexical/table";
import { $isTextNode, type ElementNode, type LexicalNode } from "lexical";

const TABLE_ROW = /^\|(.+)\|\s*$/;

/**
 * A cell is a document of its own, so its content goes through the same
 * transformers. A newline or a bare pipe inside one would end the row early,
 * which is the difference between a table and a wall of broken syntax.
 */
const exportCell = (cell: TableCellNode): string =>
	$convertToMarkdownString(COMPOSE_TRANSFORMERS, cell)
		.replace(/\n+/g, " ")
		.replace(/\|/g, "\\|")
		.trim();

const splitRow = (line: string): string[] => {
	const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const cells: string[] = [];
	let current = "";
	for (let index = 0; index < inner.length; index++) {
		const character = inner[index];
		if (character === "\\" && inner[index + 1] === "|") {
			current += "|";
			index++;
			continue;
		}
		if (character === "|") {
			cells.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	cells.push(current);
	return cells;
};

const $createCell = (text: string): TableCellNode => {
	const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
	$convertFromMarkdownString(text.trim(), COMPOSE_TRANSFORMERS, cell);
	return cell;
};

const $createRow = (texts: string[], columns: number): TableRowNode => {
	const row = $createTableRowNode();
	for (let index = 0; index < columns; index++) {
		row.append($createCell(texts[index] ?? ""));
	}
	return row;
};

const columnsOf = (table: TableNode): number => {
	const first = table.getFirstChild();
	return $isTableRowNode(first) ? first.getChildrenSize() : 0;
};

const $markFirstRowAsHeader = (table: TableNode): void => {
	const first = table.getFirstChild();
	if (!$isTableRowNode(first)) return;
	for (const cell of first.getChildren()) {
		if (!$isTableCellNode(cell)) continue;
		cell.setHeaderStyles(TableCellHeaderStates.ROW, TableCellHeaderStates.ROW);
	}
};

/**
 * `@lexical/markdown` 0.49 exports `isTableRowDivider` but no table
 * transformer, so the composer supplies one over `@lexical/table` nodes. One
 * list drives Markdown export, Markdown import and the cell round trip, which
 * is what keeps a table that left as pipes coming back as a table.
 *
 * Import runs a line at a time, each line arriving as a paragraph. A row
 * appended to the table its predecessor left behind is how the rows join up.
 * A divider carries no content of its own: it says the row above is a header.
 */
export const TABLE: ElementTransformer = {
	dependencies: [TableNode, TableRowNode, TableCellNode],
	export: (node: LexicalNode): string | null => {
		if (!$isTableNode(node)) return null;
		const lines: string[] = [];
		for (const row of node.getChildren()) {
			if (!$isTableRowNode(row)) continue;
			const cells = row.getChildren().filter($isTableCellNode);
			if (cells.length === 0) continue;
			lines.push(`| ${cells.map(exportCell).join(" | ")} |`);
			// GFM only reads a block of pipe rows as a table when a divider follows
			// the first one, so it is written whether or not that row was a header.
			// Without it a recipient sees the pipes and no table.
			if (lines.length === 1) {
				lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
			}
		}
		return lines.length === 0 ? null : lines.join("\n");
	},
	regExp: TABLE_ROW,
	replace: (parentNode: ElementNode, children, match): void => {
		const line = match[0].trimEnd();
		const previous = parentNode.getPreviousSibling();

		if (isTableRowDivider(line)) {
			if ($isTableNode(previous)) {
				$markFirstRowAsHeader(previous);
				parentNode.remove();
				return;
			}
			// A divider with no rows above it is not a table. The import emptied
			// this line's text node before calling here, so declining the match
			// would drop the characters rather than leave them alone.
			const first = children[0];
			if ($isTextNode(first)) first.setTextContent(line);
			return;
		}

		const texts = splitRow(line);
		if ($isTableNode(previous)) {
			previous.append($createRow(texts, columnsOf(previous)));
			parentNode.remove();
			return;
		}

		const table = $createTableNode();
		table.append($createRow(texts, texts.length));
		parentNode.replace(table);
	},
	type: "element",
};

/**
 * The composer's own transformer set. Everything that reads or writes Markdown
 * in compose uses this one list — the plain alternative on a rich send, the
 * body of a plain send, the down-conversion of a paste, and both directions of
 * the mode switch — so the conversions are inverses rather than four
 * independent best efforts.
 */
export const COMPOSE_TRANSFORMERS: Transformer[] = [TABLE, ...TRANSFORMERS];
