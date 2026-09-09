/**
 * Reads a handler's redelivery budget from the environment. CDK derives every
 * `*_MAX_ATTEMPTS` var from the corresponding queue's own `MAX_RECEIVE_COUNT`
 * (`infra/stacks/dev/stacks/remit-queue-stack.ts`, `deploy/vps/queues.json`)
 * so a worker's idea of "last attempt" cannot drift from the redrive policy
 * that actually dead-letters the record (issue #1270). SQS's
 * `ApproximateReceiveCount` is the source of truth for how many times a record
 * has been delivered; once it reaches this budget the current invocation is
 * the last attempt, and the handler resolves exhaustion itself instead of
 * letting the record dead-letter undiagnosed. The fallback keeps an
 * environment that never injects the var — local dev, unit tests — behaving
 * like production.
 */
export const attemptBudget = (
	envName: string,
	fallback: number,
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv[envName];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
};
