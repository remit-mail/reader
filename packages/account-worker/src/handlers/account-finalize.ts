import type { SQSHandler } from "aws-lambda";

export const processAccountFinalize = async (
	_event: unknown,
	_log?: unknown,
): Promise<void> => {
	throw new Error("Not implemented — account-finalize stub");
};

export const handler: SQSHandler = async (_event) => {
	throw new Error("Not implemented — stub for CDK synth");
};
