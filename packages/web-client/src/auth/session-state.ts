import { getErrorStatus } from "@/lib/error-classifier";

/**
 * What the session query is actually telling the gate.
 *
 * "signedOut" is the only state that may put the sign-in screen up. A session
 * lookup that failed for any other reason has not established that the user is
 * signed out, and rendering the sign-in screen for it tells them they were
 * logged out when they were not (#441).
 */
export type SessionState =
	| { kind: "pending" }
	| { kind: "active" }
	| { kind: "rateLimited" }
	| { kind: "signedOut" };

/** The shape better-auth's `useSession` hands back, read structurally. */
export interface SessionQuery {
	data: unknown;
	isPending: boolean;
	error: unknown;
}

const TOO_MANY_REQUESTS = 429;

/**
 * A held session outranks everything: better-auth keeps `data` across a failed
 * refetch unless the failure was a 401, so a throttled refresh must not evict a
 * signed-in user.
 */
export const classifySessionQuery = ({
	data,
	isPending,
	error,
}: SessionQuery): SessionState => {
	if (data) return { kind: "active" };
	if (isPending) return { kind: "pending" };
	if (getErrorStatus(error) === TOO_MANY_REQUESTS)
		return { kind: "rateLimited" };
	return { kind: "signedOut" };
};
