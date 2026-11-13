import type {
	IMailboxRepository,
	RescanFailureItem,
	RescanResultItem,
	RescanSuccessItem,
} from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { RescanFailureCode } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	type ClassifyAndRecordDeps,
	classifyAndRecord,
} from "../arrival-decision.js";
import { parseMessageBody } from "../body-parse.js";
import { ensureClassificationLabels } from "../classification-labels.js";
import { readClassifierGate } from "../classifier/classifier-gate.js";
import { isPlacementUnsettled } from "../placement-settled.js";

type FailureCode = (typeof RescanFailureCode)[keyof typeof RescanFailureCode];

export const RESCAN_LIMIT = 10;

export interface RescanDeps extends ClassifyAndRecordDeps {
	mailbox: Pick<IMailboxRepository, "get">;
	storage: Pick<StorageService, "retrieve">;
}

export interface RescanAccount {
	accountId: string;
	accountConfigId: string;
}

export interface RescanInput {
	messageIds: string[];
	move: boolean;
}

type Outcome =
	| { ok: true; success: RescanSuccessItem }
	| { ok: false; failure: RescanFailureItem };

const RETRYABLE: ReadonlySet<FailureCode> = new Set([
	RescanFailureCode.RateLimited,
	RescanFailureCode.DailyCap,
	RescanFailureCode.NotSettled,
]);

const failed = (messageId: string, code: FailureCode): Outcome => ({
	ok: false,
	failure: { messageId, code, retryable: RETRYABLE.has(code) },
});

/**
 * Checks up to {@link RESCAN_LIMIT} messages again with the category
 * classifier and the spam service (RFC 041), in parallel, and answers per
 * message as SQS `SendMessageBatch` does.
 */
export class RescanService {
	constructor(private readonly deps: RescanDeps) {}

	async rescan(
		account: RescanAccount,
		input: RescanInput,
	): Promise<RescanResultItem> {
		const { deps } = this;
		const gate = await readClassifierGate(
			deps.classifier,
			account.accountConfigId,
		);
		await ensureClassificationLabels(
			deps.spam.labelService,
			account.accountConfigId,
		);
		const ownAddresses = (
			await deps.spam.accountService.listAllByAccountConfig(
				account.accountConfigId,
			)
		).map((owned) => owned.email);
		const outcomes = await Promise.all(
			[...new Set(input.messageIds)].map((messageId) =>
				this.rescanOne(account, input.move, gate, ownAddresses, messageId),
			),
		);
		return {
			successful: outcomes.flatMap((outcome) =>
				outcome.ok ? [outcome.success] : [],
			),
			failed: outcomes.flatMap((outcome) =>
				outcome.ok ? [] : [outcome.failure],
			),
		};
	}

	private async rescanOne(
		account: RescanAccount,
		move: boolean,
		gate: Awaited<ReturnType<typeof readClassifierGate>>,
		ownAddresses: string[],
		messageId: string,
	): Promise<Outcome> {
		const { deps } = this;
		const message = await deps.message
			.get(messageId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!message) return failed(messageId, RescanFailureCode.NotFound);
		const [mailbox] = await deps.mailbox.get(account.accountId, [
			message.mailboxId,
		]);
		if (mailbox?.accountId !== account.accountId) {
			return failed(messageId, RescanFailureCode.NotPermitted);
		}
		if (move && isPlacementUnsettled(message)) {
			return failed(messageId, RescanFailureCode.NotSettled);
		}
		if (!message.bodyStorageKey) {
			return failed(messageId, RescanFailureCode.NotFound);
		}
		const raw = await deps.storage.retrieve(message.bodyStorageKey);
		const outcome = await classifyAndRecord(deps, {
			account,
			message,
			raw,
			parsed: await parseMessageBody(raw),
			gate,
			ownAddresses,
			move,
		});
		if (outcome.state === "DailyCap") {
			return failed(messageId, RescanFailureCode.DailyCap);
		}
		if (outcome.state === "RateLimited") {
			return failed(messageId, RescanFailureCode.RateLimited);
		}
		return {
			ok: true,
			success: { messageId, verdict: outcome.verdict, labels: outcome.labels },
		};
	}
}
