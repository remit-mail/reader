/**
 * Proving that nothing happened, by putting something behind it that must.
 */
import { waitForServerMailbox } from "./imap.js";

export interface BarrierArrival {
	imapUser: string;
	mailbox: string;
	/** The barrier message's own subject, unique to the run. */
	subject: string;
	timeoutMs?: number;
}

/**
 * Push a known message through the account's mutation queue and wait for it to
 * land on the mail server.
 *
 * A refusal's whole claim is that nothing was enqueued, and a read taken the
 * instant the refusal answers cannot tell that apart from a mutation still
 * sitting on the queue. An account's mutations are one FIFO group, so anything
 * the refusal had wrongly enqueued ran before this one did: once the barrier is
 * on the server, what the server holds is final and can be asserted on.
 *
 * `push` performs the operation and asserts whatever the caller wants asserted
 * about its answer, before the wait begins.
 */
export const drainWithBarrier = async (
	push: () => Promise<void>,
	{ imapUser, mailbox, subject, timeoutMs = 90_000 }: BarrierArrival,
): Promise<void> => {
	await push();
	await waitForServerMailbox(
		imapUser,
		mailbox,
		(subjects) => subjects.includes(subject),
		{ timeoutMs, what: `"${subject}" to reach ${mailbox}` },
	);
};
