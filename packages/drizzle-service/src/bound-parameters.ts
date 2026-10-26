import { getTableColumns, type Table } from "drizzle-orm";

export interface SqliteLimits {
	/** The most parameters the host's SQLite binds in one statement: 32766 on better-sqlite3, 100 on D1 and Durable Object storage. */
	maxBoundParameters: number;
}

export const BETTER_SQLITE3_LIMITS: SqliteLimits = {
	maxBoundParameters: 32766,
};

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size));
	}
	return chunks;
};

export const rowsPerStatement = (
	maxBoundParameters: number,
	parametersPerRow: number,
	reservedParameters = 0,
): number => {
	const rows = Math.floor(
		(maxBoundParameters - reservedParameters) / parametersPerRow,
	);
	if (rows < 1) {
		throw new RangeError(
			`a row of ${parametersPerRow} bound parameters does not fit a statement limit of ${maxBoundParameters}`,
		);
	}
	return rows;
};

export const chunkRows = <T>(
	table: Table,
	rows: readonly T[],
	maxBoundParameters: number,
	reservedParameters = 0,
): T[][] =>
	chunk(
		rows,
		rowsPerStatement(
			maxBoundParameters,
			Object.keys(getTableColumns(table)).length,
			reservedParameters,
		),
	);
