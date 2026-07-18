/**
 * A backend's binding for a conformance suite: how to build the repository
 * under test, how to tear its backing store down, and the two behaviours the
 * suite cannot express portably — id minting and not-found detection, both of
 * which differ per implementation.
 */
export interface RepositoryConformanceHarness<TRepo> {
	createRepository(): Promise<TRepo>;
	teardown(): Promise<void>;
	makeId(): string;
	isNotFoundError(error: unknown): boolean;
}
