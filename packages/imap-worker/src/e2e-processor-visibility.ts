/**
 * Receive-time visibility (seconds) the e2e drainer requests for a queue.
 *
 * A message the handler reports as failed is left un-deleted and only
 * redelivers once its visibility lapses. The sync queues are per-account FIFO
 * (`MessageGroupId = accountId`): while one message sits invisible, every later
 * message in its group is held back too. So the visibility window a failed sync
 * event sits out is also the window the whole account's sync pipeline stalls —
 * and at a multi-minute window that stall swallows a spec's entire seed-and-wait
 * budget when a transient IMAP hiccup fails one event mid-run, which is the
 * recurring e2e-dev flake (#290).
 *
 * FIFO sync queues therefore get a short window: a transient failure costs one
 * brief retry instead of a minutes-long group stall, and the handlers on these
 * queues (a mailbox LIST, a header SEARCH/FETCH) finish well inside it — a rare
 * slow round redelivers harmlessly, since the mailbox lock makes a concurrent
 * re-run a no-op. The standard queues (body sync's ranged FETCH of up to 200
 * message bodies, the management queues) keep the longer window their slower,
 * non-FIFO work needs and where a redelivery blocks nothing but itself.
 */
export const FIFO_RECEIVE_VISIBILITY_SECONDS = 30;
export const STANDARD_RECEIVE_VISIBILITY_SECONDS = 300;

export const receiveVisibilitySeconds = (queueUrl: string): number =>
	queueUrl.endsWith(".fifo")
		? FIFO_RECEIVE_VISIBILITY_SECONDS
		: STANDARD_RECEIVE_VISIBILITY_SECONDS;
