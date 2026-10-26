import type {
	IAccountRepository,
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IOutboxAttachmentRepository,
	IOutboxMessageRepository,
} from "@remit/data-ports";

/**
 * The repositories the SMTP send path reads and writes. One neutral seam so the
 * same handler serves every stack.
 */
export interface SmtpDataPorts {
	account: IAccountRepository;
	outboxMessage: IOutboxMessageRepository;
	outboxAttachment: IOutboxAttachmentRepository;
	address: IAddressRepository;
	message: IMessageRepository;
	envelope: IEnvelopeRepository;
}
