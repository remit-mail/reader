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
