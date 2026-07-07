const LOOPBACK_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
	"host.docker.internal",
]);

/**
 * Whether APISIX should verify TLS when fetching the OIDC discovery / JWKS
 * document from `discoveryUrl`.
 *
 * A plaintext (`http:`) hop has no certificate to verify, and loopback /
 * docker-host addresses are the dev-only path where the IdP shares the host. For
 * every other (deployed) host verification must be on: without it a MITM on the
 * edge → IdP path could serve a forged JWKS and have minted tokens accepted.
 */
export const shouldVerifyDiscoveryTls = (discoveryUrl: string): boolean => {
	const { protocol, hostname } = new URL(discoveryUrl);
	if (protocol !== "https:") return false;
	return !LOOPBACK_HOSTS.has(hostname);
};
