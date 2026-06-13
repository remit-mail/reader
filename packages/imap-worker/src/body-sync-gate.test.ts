import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	GetParameterCommand,
	ParameterNotFound,
	SSMClient,
} from "@aws-sdk/client-ssm";
import type { Logger } from "@remit/logger-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { isBodySyncEnabled, resetBodySyncGateCache } from "./body-sync-gate.js";

const parameterName = "/dev/Remit/bodySyncEnabled";

interface CapturedWarn {
	args: unknown[];
}

const createCapturingLogger = (): {
	log: Logger;
	warnCalls: CapturedWarn[];
} => {
	const warnCalls: CapturedWarn[] = [];
	const noop = () => {};
	const log = {
		info: noop,
		warn: (...args: unknown[]) => warnCalls.push({ args }),
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return { log, warnCalls };
};

const warnMessage = (warn: CapturedWarn): string => String(warn.args[1]);

describe("isBodySyncEnabled", () => {
	beforeEach(() => {
		resetBodySyncGateCache();
	});

	afterEach(() => {
		mockClient(SSMClient).reset();
		resetBodySyncGateCache();
	});

	it("returns true when the parameter is 'true'", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.resolves({ Parameter: { Value: "true" } });
		const { log } = createCapturingLogger();

		const enabled = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(enabled, true);
	});

	it("returns false when the parameter is 'false'", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.resolves({ Parameter: { Value: "false" } });
		const { log } = createCapturingLogger();

		const enabled = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(enabled, false);
	});

	it("treats casing and whitespace as disabled for ' FALSE '", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.resolves({ Parameter: { Value: " FALSE " } });
		const { log } = createCapturingLogger();

		const enabled = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(enabled, false);
	});

	it("fails open with a warning when the parameter does not exist", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.rejects(new ParameterNotFound({ message: "not found", $metadata: {} }));
		const { log, warnCalls } = createCapturingLogger();

		const enabled = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(enabled, true);
		assert.equal(warnCalls.length, 1);
		assert.match(warnMessage(warnCalls[0]), /failing open/i);
	});

	it("fails open with a warning when the parameter has no value", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.resolves({ Parameter: {} });
		const { log, warnCalls } = createCapturingLogger();

		const enabled = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(enabled, true);
		assert.equal(warnCalls.length, 1);
		assert.match(warnMessage(warnCalls[0]), /missing a value/i);
	});

	it("caches the result within the TTL — second call does not re-fetch", async () => {
		const ssmMock = mockClient(SSMClient);
		ssmMock
			.on(GetParameterCommand, { Name: parameterName })
			.resolves({ Parameter: { Value: "false" } });
		const { log } = createCapturingLogger();

		const first = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);
		const second = await isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.equal(first, false);
		assert.equal(second, false);
		assert.equal(ssmMock.commandCalls(GetParameterCommand).length, 1);
	});

	it("coalesces concurrent cold-cache calls into a single GetParameter", async () => {
		const ssmMock = mockClient(SSMClient);
		let resolveSend:
			| ((value: { Parameter: { Value: string } }) => void)
			| undefined;
		ssmMock.on(GetParameterCommand, { Name: parameterName }).callsFake(
			() =>
				new Promise((resolve) => {
					resolveSend = resolve;
				}),
		);
		const { log } = createCapturingLogger();

		const a = isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);
		const b = isBodySyncEnabled(
			parameterName,
			log,
			ssmMock as unknown as SSMClient,
		);

		assert.ok(resolveSend, "GetParameter should have been invoked");
		resolveSend?.({ Parameter: { Value: "true" } });

		assert.deepEqual(await Promise.all([a, b]), [true, true]);
		assert.equal(ssmMock.commandCalls(GetParameterCommand).length, 1);
	});
});
