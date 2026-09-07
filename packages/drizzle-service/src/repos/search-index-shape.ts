/**
 * Whether an installed FTS5 search index carries the columns the shipped one
 * declares.
 *
 * `CREATE VIRTUAL TABLE IF NOT EXISTS` is a no-op against a table that already
 * exists, so a database installed by an earlier build keeps that build's
 * columns for good. A predicate naming a column that build never indexed does
 * not degrade — SQLite raises, and every search on that instance fails — so the
 * migrator compares the two shapes and rebuilds where they differ.
 *
 * Both sides are read from DDL rather than from a hand-kept list: the shipped
 * side is the committed `.sql`, the installed side is what `sqlite_master`
 * holds, and neither can drift from what is actually there.
 */

/** The text between the parentheses of a `USING fts5(...)` clause. */
const fts5Arguments = (ddl: string): string => {
	const clause = ddl.search(/using\s+fts5\s*\(/i);
	if (clause === -1) return "";
	const open = ddl.indexOf("(", clause);
	let depth = 0;
	for (let index = open; index < ddl.length; index++) {
		const char = ddl[index];
		if (char === "(") depth++;
		if (char !== ")") continue;
		depth--;
		if (depth === 0) return ddl.slice(open + 1, index);
	}
	return "";
};

/**
 * The indexed column names an FTS5 table declares. An argument carrying an `=`
 * is an option (`content=`, `tokenize=`), not a column, and anything quoted or
 * otherwise unusual is left out rather than guessed at — a name this cannot
 * read is a name the comparison must not claim is missing.
 */
export const searchIndexColumns = (ddl: string): string[] =>
	fts5Arguments(ddl)
		.split(",")
		.map((argument) => argument.trim())
		.filter((argument) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(argument));

/**
 * Whether `installed` indexes every column `shipped` does. A superset passes:
 * an extra column indexes text no predicate reads, which costs space and
 * matches nothing wrong.
 */
export const searchIndexShapeIsCurrent = (
	installed: string,
	shipped: string,
): boolean => {
	const columns = new Set(searchIndexColumns(installed));
	const expected = searchIndexColumns(shipped);
	return expected.length > 0 && expected.every((column) => columns.has(column));
};
