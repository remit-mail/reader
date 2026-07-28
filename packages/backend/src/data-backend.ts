/**
 * The self-host SQL backend (RFC 034/035/036), as opposed to the AWS DynamoDB
 * path.
 */
export const isSelfHostSqlBackend = (): boolean =>
	process.env.DATA_BACKEND === "sqlite";

/**
 * The self-host SQL backend authenticates requests and signs content URLs with
 * a better-auth RS256 JWT verified at the edge and re-verified in-process, no
 * Cognito authorizer. DynamoDB is the AWS path (Cognito claims, Lambda@Edge
 * content guard) and is deliberately excluded.
 */
export const usesBetterAuthJwt = (): boolean => isSelfHostSqlBackend();
