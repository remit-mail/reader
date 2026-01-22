export interface BaseEvent {
	accountId: string;
	eventId: string; // Idempotency key
	timestamp: number;
}

export interface SendMessageEvent extends BaseEvent {
	type: "SEND_MESSAGE";
	outboxMessageId: string;
}

export interface ProcessOutboxEvent extends BaseEvent {
	type: "PROCESS_OUTBOX";
	// Processes all queued messages for the account
}

export type SmtpEvent = SendMessageEvent | ProcessOutboxEvent;
