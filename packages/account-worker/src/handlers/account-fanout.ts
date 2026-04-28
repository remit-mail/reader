import type { SQSHandler } from "aws-lambda";

export const processAccountFanout = async (
	_event: unknown,
	_log?: unknown,
): Promise<void> => {
	throw new Error("Not implemented — account-fanout stub");
};

export const handler: SQSHandler = async (_event) => {
	throw new Error("Not implemented — stub for CDK synth");
};
