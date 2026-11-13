import type {
	DomainRegistrationItem,
	PutDomainRegistrationInput,
} from "../types.js";

/**
 * Successful RDAP answers, one row per registrable domain (RFC 041). A
 * registration date never changes, so a row is written once and read forever.
 */
export interface IDomainRegistrationRepository {
	/** Throws the adapter's not-found error when the domain was never cached. */
	get(registrableDomain: string): Promise<DomainRegistrationItem>;
	put(input: PutDomainRegistrationInput): Promise<DomainRegistrationItem>;
}
