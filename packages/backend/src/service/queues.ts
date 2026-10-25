import type {
	AccountFanoutEvent,
	FifoQueueProducer,
	QueueProducer,
} from "@remit/data-ports";
import type {
	FlagPushEvent,
	MailboxManagementEvent,
	MessageMoveQueueEvent,
	PlacementMovePushEvent,
	SendMessageEvent,
	SyncMessageBodyEvent,
} from "@remit/mailbox-service";
import type { SyncMailboxesEvent } from "./trigger-sync.js";

export type SyncQueueEvent =
	| SyncMailboxesEvent
	| FlagPushEvent
	| MailboxManagementEvent
	| MessageMoveQueueEvent;

export interface RemitClientQueues {
	sync: FifoQueueProducer<SyncQueueEvent>;
	accountFanout: QueueProducer<AccountFanoutEvent>;
	smtp: FifoQueueProducer<SendMessageEvent>;
	messageManagement: QueueProducer<PlacementMovePushEvent>;
	body: QueueProducer<SyncMessageBodyEvent>;
}

export type QueueName = keyof RemitClientQueues;
