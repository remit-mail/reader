export interface SqsStaticCredentials {
	accessKeyId: string;
	secretAccessKey: string;
}

// On AWS, SQS shares the process-wide credential chain (AWS_ACCESS_KEY_ID / IAM
// role). On Scaleway, Messaging & Queuing has its own credential pair, distinct
// from the Object Storage (S3) keys, so it can't ride the default chain — the app
// is handed SQS_ACCESS_KEY_ID / SQS_SECRET_ACCESS_KEY and must feed them to the
// SQS client explicitly. When they are absent (AWS, or local ElasticMQ), returning
// undefined lets the SDK fall back to its default credential provider chain.
export function resolveSqsCredentials(
	env: NodeJS.ProcessEnv = process.env,
): SqsStaticCredentials | undefined {
	const accessKeyId = env.SQS_ACCESS_KEY_ID;
	const secretAccessKey = env.SQS_SECRET_ACCESS_KEY;

	if (accessKeyId && secretAccessKey) {
		return { accessKeyId, secretAccessKey };
	}

	return undefined;
}
