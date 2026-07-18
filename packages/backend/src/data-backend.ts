/**
 * The two self-host SQL backends (RFC 034/035/036), as opposed to the AWS
 * DynamoDB path.
 */
export const isSelfHostSqlBackend = (): boolean => {
	const backend = process.env.DATA_BACKEND;
	return backend === "postgres" || backend === "sqlite";
};

/**
 * The self-host SQL backends authenticate requests and sign content URLs the
 * same way: a better-auth RS256 JWT verified at the edge and re-verified
 * in-process, no Cognito authorizer. DynamoDB is the AWS path (Cognito claims,
 * Lambda@Edge content guard) and is deliberately excluded.
 *
 * Guarding these paths on `=== "postgres"` alone left the sqlite deployment
 * with no claim injection (every identity-bound request 500s) and unsigned
 * `/content/*` URLs; both branch on this predicate instead.
 */
export const usesBetterAuthJwt = (): boolean => isSelfHostSqlBackend();
