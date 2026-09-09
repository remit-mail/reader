/**
 * What the surfaces backed by stored message vectors say on an instance with
 * semantic search off (#1068).
 *
 * Off is a deployment setting, not a failure, so the copy names the command
 * that changes it and what changing it buys: the Organize widen to similar
 * mail, and filters that match on similarity. It deliberately promises nothing
 * about the "Similar messages" panel filling — answering a typed query needs a
 * query embedder no self-host image carries, so that panel is empty either way
 * (deploy/vps/README.md, Search).
 */
export const SEMANTIC_OFF_TITLE = "Semantic search is off on this instance.";

export const SEMANTIC_OFF_BUYS =
	"On, it stores a vector for every message, which is what the Organize widen to similar mail and semantic filters read.";

export const SEMANTIC_OFF_COMMAND = "remit semantic on";

/** The same three facts as one line, for a surface with room for one. */
export const semanticOffReason = `${SEMANTIC_OFF_TITLE} ${SEMANTIC_OFF_BUYS} Run '${SEMANTIC_OFF_COMMAND}' on the server.`;
