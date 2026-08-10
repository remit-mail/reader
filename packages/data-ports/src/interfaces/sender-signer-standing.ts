import type {
	ObserveSenderSignerStandingInput,
	SenderSignerStandingItem,
} from "../types.js";

/**
 * Per-account record of how often one sender has been seen arriving under one
 * DKIM signing identity.
 *
 * The authenticity derivation asks this port two things: whether a key already
 * had standing when a message arrived, and — afterwards — that this message be
 * counted. `get` answers the first and must not create anything; `observe`
 * answers the second and is the only writer.
 */
export interface ISenderSignerStandingRepository {
	/**
	 * Record one observation of a key, creating the row at `messageCount = 1`
	 * or incrementing an existing one.
	 *
	 * `firstSeenAt` is set once, on creation, and never moves — an
	 * implementation that rewrites it on the increment path erases the age the
	 * derivation reads standing from. `lastSeenAt` advances on every call.
	 */
	observe(
		input: ObserveSenderSignerStandingInput,
	): Promise<SenderSignerStandingItem>;

	/**
	 * The standing of one key. Throws the adapter's not-found error when the
	 * key has never been observed, and creates nothing.
	 */
	get(
		accountConfigId: string,
		senderKey: string,
		signerDomain: string,
	): Promise<SenderSignerStandingItem>;
}
