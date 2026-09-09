/**
 * The deployment's coordinates, as the suite sees them from outside. Every
 * value comes from the environment `npm run e2e:test` exports out of
 * `deploy/vps/e2e.env`, so the suite and the stack can never disagree about
 * which port or which mailbox they mean.
 */

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set — run via \`npm run e2e\``);
	return value;
};

export const baseUrl = `http://localhost:${required("E2E_HTTP_PORT")}`;

/** How the suite reaches Dovecot: a published loopback port. */
export const imap = {
	host: "127.0.0.1",
	port: Number(required("E2E_IMAP_PORT")),
	password: required("E2E_IMAP_PASSWORD"),
};

/**
 * The mailbox this run owns. Dovecot accepts any username with the shared
 * password and hands each one its own empty maildir, so minting a name here is
 * what isolates a run — including on a stack that a previous run left behind.
 */
export const mintImapUser = (): string =>
	`run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@remit.test`;

/**
 * How the deployment reaches Dovecot. On the image stack the app is a container
 * on the compose network and uses the service name and the unpublished port; on
 * the source-built stack it is a host process and goes through the same
 * published loopback port the suite does, which is what E2E_IMAP_STACK_PORT
 * says.
 */
export const imapFromStack = {
	host: required("E2E_IMAP_HOST"),
	port: Number(process.env.E2E_IMAP_STACK_PORT ?? 143),
};

/**
 * One mail server, addressed from both sides: the published loopback port the
 * suite APPENDs through, and the coordinates the deployment dials it on.
 */
export interface ImapLane {
	suite: { host: string; port: number };
	stack: { host: string; port: number };
}

export const defaultImapLane: ImapLane = {
	suite: imap,
	stack: imapFromStack,
};

/**
 * A second Dovecot that flags no folder \Trash and autocreates `Deleted
 * Messages` instead, so the Trash role resolves from that folder's name and
 * from nothing else. Every mailbox the default lane hands out carries the flag,
 * which left the name tier — the evidence an expunge may not act on (#876) —
 * with no server to run against.
 *
 * An account only goes here because a spec asked for it, through
 * `provisionIsolatedRun`'s imap override.
 */
export const namedTrashImapLane: ImapLane = {
	suite: {
		host: "127.0.0.1",
		port: Number(required("E2E_IMAP_NAMED_TRASH_PORT")),
	},
	stack: {
		host: required("E2E_IMAP_NAMED_TRASH_HOST"),
		port: Number(process.env.E2E_IMAP_NAMED_TRASH_STACK_PORT ?? 143),
	},
};

const laneByUser = new Map<string, ImapLane>();

/**
 * A mailbox lives on exactly one server, and the username is that mailbox's
 * identity — so every IMAP helper can find the lane from the user it was handed
 * rather than carrying one through signatures nothing else needs. Provisioning
 * registers the mapping; anything unregistered is on the lane every other
 * account uses.
 */
export const registerImapLane = (user: string, lane: ImapLane): void => {
	laneByUser.set(user, lane);
};

export const imapLaneFor = (user: string): ImapLane =>
	laneByUser.get(user) ?? defaultImapLane;

/**
 * How the deployment reaches the SMTP sink — the address an account's
 * `smtpHost`/`smtpPort` is set to, so a send leaves the process instead of
 * resolving to `blocked`. Same split as `imapFromStack`: the compose service
 * name on the image lane, the published loopback port on the source-built one.
 */
export const smtpFromStack = {
	host: required("E2E_SMTP_HOST"),
	port: Number(process.env.E2E_SMTP_STACK_PORT ?? 1025),
};

/** Where the suite reads the bytes the sink accepted: Mailpit's HTTP API. */
export const smtpSinkApi = `http://127.0.0.1:${required("E2E_SMTP_HTTP_PORT")}`;

/**
 * How the deployment reaches the lane that refuses — a second Mailpit whose
 * recipient allowlist matches nobody, so it answers every RCPT TO with 550.
 * Same split as `smtpFromStack`.
 *
 * An account only goes here because a spec asked for it, through
 * `provisionIsolatedRun`'s smtp override. Nothing else in the suite sends to a
 * server that refuses, and the default lane is unaffected by this one existing.
 */
export const rejectingSmtpFromStack = {
	host: required("E2E_SMTP_REJECT_HOST"),
	port: Number(process.env.E2E_SMTP_REJECT_STACK_PORT ?? 1025),
};

/**
 * Where the suite reads what the refusing lane accepted — which, for a message
 * it refused, has to be nothing. Its own API and not the default lane's: the two
 * sinks hold different mail, so a count taken over the wrong one proves nothing.
 */
export const rejectingSmtpSinkApi = `http://127.0.0.1:${required("E2E_SMTP_REJECT_HTTP_PORT")}`;

/**
 * The queue sidecar, over the SQS protocol the workers themselves speak to it.
 *
 * The one internal listener either lane publishes to the host, and only on
 * loopback: it authenticates nobody and carries every account's work. A spec
 * uses it to put an event back on a queue, which is the only way to produce the
 * redelivery an at-least-once queue produces on its own (#858).
 */
export const queueApi = `http://127.0.0.1:${required("E2E_QUEUE_PORT")}`;
