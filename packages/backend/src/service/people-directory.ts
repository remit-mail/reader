import type { PeopleDirectory } from "@remit/auth-service/people";

let registered: PeopleDirectory | null = null;

/**
 * Register the self-host people directory from the composition root. A host
 * that registers none answers every People operation with 404, which is what
 * keeps better-auth out of any bundle that only serves the mail API.
 */
export const setPeopleDirectory = (directory: PeopleDirectory | null): void => {
	registered = directory;
};

export const getPeopleDirectory = (): PeopleDirectory | null => registered;
