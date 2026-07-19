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
	user: required("E2E_IMAP_USER"),
	password: required("E2E_IMAP_PASSWORD"),
};

/** How the deployment reaches Dovecot: a service name on the compose network. */
export const imapFromStack = {
	host: required("E2E_IMAP_HOST"),
	port: 143,
};
