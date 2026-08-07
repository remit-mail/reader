/**
 * What a draft has spoken for, as one object the storage backend can
 * compare-and-set.
 *
 * The cap used to be enforced by a promise chain inside one process, which is
 * only true on a deployment that runs exactly one backend. The hosted shape is
 * Lambda: six parallel mints are six execution environments, and a chain in any
 * one of them guards nothing. So the reservation list lives in storage and every
 * change to it is conditional on the version that was read — two mints racing,
 * one writes, the other is told its version is stale and reruns against what
 * actually landed. The cap becomes a property of the data.
 *
 * The ledger is also what makes an uploaded object *real*. An object with no
 * entry pointing at it is garbage — a PUT that arrived after its draft was
 * discarded, say — and is collected rather than counted.
 */

export interface OutboxLedgerEntry {
	outboxAttachmentId: string;
	filename: string;
	contentType: string;
	/** Bytes reserved at mint, and confirmed against storage on completion. */
	sizeBytes: number;
	/** Unix seconds this reservation lapses at. Ignored once uploaded. */
	expiresAt: number;
	/** True once the bytes were found in storage at the reserved size. */
	uploaded: boolean;
}

export interface OutboxLedger {
	entries: OutboxLedgerEntry[];
}

export const EMPTY_OUTBOX_LEDGER: OutboxLedger = { entries: [] };

/**
 * A backend-supplied token for the version that was read. Null means "no ledger
 * existed", which a write turns into a create-if-absent.
 */
export type OutboxLedgerVersion = string | null;

export interface OutboxLedgerRead {
	ledger: OutboxLedger;
	version: OutboxLedgerVersion;
}

/** Conditional write outcome. `Stale` means someone else got there first. */
export type OutboxLedgerWrite = "Written" | "Stale";

export const parseOutboxLedger = (raw: string): OutboxLedger => {
	const parsed: unknown = JSON.parse(raw);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray((parsed as { entries?: unknown }).entries)
	) {
		return { entries: [] };
	}
	return { entries: (parsed as OutboxLedger).entries };
};

export const serializeOutboxLedger = (ledger: OutboxLedger): Buffer =>
	Buffer.from(JSON.stringify(ledger), "utf8");

/** Entries still worth counting: uploaded, or reserved and not yet lapsed. */
export const liveEntries = (
	ledger: OutboxLedger,
	nowSeconds: number,
): OutboxLedgerEntry[] =>
	ledger.entries.filter(
		(entry) => entry.uploaded || entry.expiresAt >= nowSeconds,
	);

export const totalBytes = (entries: readonly OutboxLedgerEntry[]): number =>
	entries.reduce((total, entry) => total + entry.sizeBytes, 0);
