const STRUCTURED_SUFFIXES = ["sender", "recipient", "subject", "attachment"];

// Ceiling on body / entity chunks per message, shared with the producers
// (entropy.ts, entities.ts) so every chunk a message can emit has a reapable
// delete key. Observed counts are 1-19; DeleteVectors ignores keys that don't
// exist, so the delete stays scan-free.
export const MAX_CHUNKS_PER_TYPE = 128;

export const chunkKeyFor = (messageId: string, suffix: string): string =>
	`${messageId}::${suffix}`;

// Every deterministic key a message's chunks can occupy, in lockstep with the
// suffixes the chunker emits (structured.ts, entropy.ts, entities.ts). Lets a
// message be deleted by addressing its keys directly — never listing the index.
export const candidateChunkKeys = (messageId: string): string[] => {
	const suffixes = [...STRUCTURED_SUFFIXES, "entities"];
	for (let i = 0; i < MAX_CHUNKS_PER_TYPE; i++) {
		suffixes.push(`body-${i}`);
		suffixes.push(`entities-${i}`);
	}
	return suffixes.map((suffix) => chunkKeyFor(messageId, suffix));
};
