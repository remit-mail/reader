import {
	outboxDetailOperationsDeleteOutboxMessageMutation,
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxDetailOperationsSendOutboxMessageMutation,
	outboxOperationsCreateOutboxMessageMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Value } from "platejs";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import { useSaveDraft } from "../../hooks/useSaveDraft";
import { useSignature } from "../../hooks/useSignature.js";
import {
	plateValueToHtml,
	plateValueToText,
} from "../../lib/plate-serializer.js";
import type { AddressEntry } from "./AddressField";
import { AddressField } from "./AddressField";
import { ComposeActionBar } from "./ComposeActionBar";

const LazyComposeBody = lazy(() =>
	import("./ComposeBody.js").then((m) => ({ default: m.ComposeBody })),
);

const ComposeBodyFallback = () => (
	<div className="min-h-[120px] px-3 py-2">
		<div className="h-8 mb-2 rounded bg-muted animate-pulse" />
		<div className="min-h-[80px] rounded bg-muted/50 animate-pulse" />
	</div>
);

import type { ComposeMode } from "./ComposeProvider";
import { useCompose } from "./ComposeProvider";
import { FromSelector } from "./FromSelector";
import { QuotedText } from "./QuotedText";
import { SubjectField } from "./SubjectField";

interface ComposeFormProps {
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	onClose: () => void;
	onAccountChange?: (account: RemitImapAccountResponse) => void;
}

const EMPTY_PARAGRAPH: Value = [{ type: "p", children: [{ text: "" }] }];

const SIGNATURE_SEPARATOR: Value = [
	{ type: "p", children: [{ text: "" }] },
	{ type: "p", children: [{ text: "-- " }] },
];

const buildInitialBody = (signaturePlainText: string): Value => {
	if (!signaturePlainText) return EMPTY_PARAGRAPH;
	return [
		...SIGNATURE_SEPARATOR,
		{ type: "p", children: [{ text: signaturePlainText }] },
	];
};

const buildReplySubject = (subject?: string): string => {
	if (!subject) return "Re: ";
	if (/^re:\s/i.test(subject)) return subject;
	return `Re: ${subject}`;
};

const buildForwardSubject = (subject?: string): string => {
	if (!subject) return "Fwd: ";
	if (/^fwd?:\s/i.test(subject)) return subject;
	return `Fwd: ${subject}`;
};

const extractTextForQuote = (
	msg?: RemitImapDescribeMessageResponse,
): string => {
	if (!msg) return "";
	return msg.bodyText ?? "";
};

const getReplyAddresses = (
	msg: RemitImapDescribeMessageResponse,
	mode: ComposeMode,
	myEmail?: string,
): { to: AddressEntry[]; cc: AddressEntry[] } => {
	const { envelope } = msg;
	const replyTo =
		envelope.replyTo.length > 0 ? envelope.replyTo : envelope.from;

	const to: AddressEntry[] = replyTo.map((a) => ({
		email: a.normalizedEmail,
		displayName: a.displayName,
	}));

	if (mode !== "reply_all") return { to, cc: [] };

	const myEmailLower = myEmail?.toLowerCase();
	const toEmails = new Set(to.map((a) => a.email.toLowerCase()));

	const cc: AddressEntry[] = [...envelope.to, ...envelope.cc]
		.filter(
			(a) =>
				a.normalizedEmail.toLowerCase() !== myEmailLower &&
				!toEmails.has(a.normalizedEmail.toLowerCase()),
		)
		.map((a) => ({
			email: a.normalizedEmail,
			displayName: a.displayName,
		}));

	return { to, cc };
};

const getReferences = (
	msg: RemitImapDescribeMessageResponse,
): { inReplyTo?: string; references: string[] } => {
	const messageIdValue = msg.envelope.messageIdValue;
	const existingRefs = msg.references
		.filter((r) => r.referenceType === "references")
		.sort((a, b) => a.referenceOrder - b.referenceOrder)
		.map((r) => r.messageIdValue);

	const references = [...existingRefs];
	if (messageIdValue && !references.includes(messageIdValue)) {
		references.push(messageIdValue);
	}

	return {
		inReplyTo: messageIdValue,
		references,
	};
};

const isFormEmpty = (
	toAddresses: AddressEntry[],
	ccAddresses: AddressEntry[],
	bccAddresses: AddressEntry[],
	subject: string,
	body: Value,
): boolean =>
	toAddresses.length === 0 &&
	ccAddresses.length === 0 &&
	bccAddresses.length === 0 &&
	subject.trim() === "" &&
	plateValueToText(body).trim() === "";

export const ComposeForm = ({
	mode,
	account,
	sourceMessage,
	onClose,
	onAccountChange,
}: ComposeFormProps) => {
	const { state, setOutboxMessageId } = useCompose();
	const { outboxMessageId } = state;

	const [toAddresses, setToAddresses] = useState<AddressEntry[]>([]);
	const [ccAddresses, setCcAddresses] = useState<AddressEntry[]>([]);
	const [bccAddresses, setBccAddresses] = useState<AddressEntry[]>([]);
	const [subject, setSubject] = useState("");
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);
	const [selectedAccountId, setSelectedAccountId] = useState(
		account?.accountId,
	);
	const [draftLoaded, setDraftLoaded] = useState(false);

	const { signature } = useSignature(selectedAccountId);
	const [body, setBody] = useState<Value>(() =>
		buildInitialBody(signature.plainText),
	);

	const { data: draftData } = useQuery({
		...outboxDetailOperationsGetOutboxMessageOptions({
			path: { outboxMessageId: outboxMessageId ?? "" },
		}),
		enabled: !!outboxMessageId && !draftLoaded,
	});

	useEffect(() => {
		if (!draftData || draftLoaded) return;

		setToAddresses(
			draftData.toAddresses.map((email) => ({ email, displayName: undefined })),
		);
		if (draftData.ccAddresses && draftData.ccAddresses.length > 0) {
			setCcAddresses(
				draftData.ccAddresses.map((email) => ({
					email,
					displayName: undefined,
				})),
			);
			setShowCc(true);
		}
		if (draftData.bccAddresses && draftData.bccAddresses.length > 0) {
			setBccAddresses(
				draftData.bccAddresses.map((email) => ({
					email,
					displayName: undefined,
				})),
			);
			setShowBcc(true);
		}
		if (draftData.subject) setSubject(draftData.subject);
		if (draftData.textBody)
			setBody([{ type: "p", children: [{ text: draftData.textBody }] }]);
		setSelectedAccountId(draftData.accountId);
		setDraftLoaded(true);
	}, [draftData, draftLoaded]);

	useEffect(() => {
		if (!sourceMessage) return;

		if (mode === "reply" || mode === "reply_all") {
			const { to, cc } = getReplyAddresses(sourceMessage, mode, account?.email);
			setToAddresses(to);
			setCcAddresses(cc);
			if (cc.length > 0) setShowCc(true);
			setSubject(buildReplySubject(sourceMessage.envelope.subject));
		}

		if (mode === "forward") {
			setSubject(buildForwardSubject(sourceMessage.envelope.subject));
		}
	}, [mode, sourceMessage, account?.email]);

	const quotedText = useMemo(
		() => extractTextForQuote(sourceMessage),
		[sourceMessage],
	);

	const quotedHtml = sourceMessage?.bodyHtml;

	const senderName =
		sourceMessage?.envelope.from[0]?.displayName ??
		sourceMessage?.envelope.from[0]?.normalizedEmail;

	const { saveStatus, saveDraft, cancelAutoSave } = useSaveDraft({
		outboxMessageId,
		onDraftCreated: setOutboxMessageId,
	});

	const createMutation = useMutation(
		outboxOperationsCreateOutboxMessageMutation(),
	);

	const sendMutation = useMutation(
		outboxDetailOperationsSendOutboxMessageMutation(),
	);

	const deleteMutation = useMutation(
		outboxDetailOperationsDeleteOutboxMessageMutation(),
	);

	const isSending = createMutation.isPending || sendMutation.isPending;
	const canSend = toAddresses.length > 0 && !!selectedAccountId;

	useEffect(() => {
		if (!selectedAccountId) return;
		if (isFormEmpty(toAddresses, ccAddresses, bccAddresses, subject, body))
			return;

		const textBody = plateValueToText(body);
		const htmlBody = plateValueToHtml(body);

		saveDraft({
			accountId: selectedAccountId,
			toAddresses: toAddresses.map((a) => a.email),
			ccAddresses:
				ccAddresses.length > 0 ? ccAddresses.map((a) => a.email) : undefined,
			bccAddresses:
				bccAddresses.length > 0 ? bccAddresses.map((a) => a.email) : undefined,
			subject: subject || undefined,
			textBody: textBody || undefined,
			htmlBody: htmlBody || undefined,
		});
	}, [
		selectedAccountId,
		toAddresses,
		ccAddresses,
		bccAddresses,
		subject,
		body,
		saveDraft,
	]);

	const handleSend = useCallback(async () => {
		if (!selectedAccountId || toAddresses.length === 0) return;

		cancelAutoSave();

		const replyData =
			sourceMessage && (mode === "reply" || mode === "reply_all")
				? getReferences(sourceMessage)
				: {};

		if (outboxMessageId) {
			await sendMutation.mutateAsync({
				path: { outboxMessageId },
			});
			toast.success("Message sent");
			onClose();
			return;
		}

		const textBody = plateValueToText(body);
		const htmlBody = plateValueToHtml(body);

		const outboxMessage = await createMutation.mutateAsync({
			body: {
				accountId: selectedAccountId,
				toAddresses: toAddresses.map((a) => a.email),
				ccAddresses:
					ccAddresses.length > 0 ? ccAddresses.map((a) => a.email) : undefined,
				bccAddresses:
					bccAddresses.length > 0
						? bccAddresses.map((a) => a.email)
						: undefined,
				subject: subject || undefined,
				textBody: textBody || undefined,
				htmlBody: htmlBody || undefined,
				sendImmediately: true,
				...replyData,
			},
		});

		await sendMutation.mutateAsync({
			path: { outboxMessageId: outboxMessage.outboxMessageId },
		});

		toast.success("Message sent");
		onClose();
	}, [
		selectedAccountId,
		toAddresses,
		ccAddresses,
		bccAddresses,
		subject,
		body,
		mode,
		sourceMessage,
		outboxMessageId,
		createMutation,
		sendMutation,
		cancelAutoSave,
		onClose,
	]);

	const handleDiscard = useCallback(() => {
		cancelAutoSave();
		if (outboxMessageId) {
			deleteMutation.mutate({
				path: { outboxMessageId },
			});
		}
		onClose();
	}, [cancelAutoSave, outboxMessageId, deleteMutation, onClose]);

	const handleAccountChange = useCallback(
		(acct: RemitImapAccountResponse) => {
			setSelectedAccountId(acct.accountId);
			onAccountChange?.(acct);
		},
		[onAccountChange],
	);

	return (
		<div className="flex flex-col h-full">
			<div className="space-y-1 px-3 py-2 border-b border-border">
				<FromSelector
					selectedAccountId={selectedAccountId}
					onSelect={handleAccountChange}
				/>
				<AddressField
					label="To"
					addresses={toAddresses}
					onChange={setToAddresses}
					placeholder="Recipients"
				/>
				{showCc ? (
					<AddressField
						label="Cc"
						addresses={ccAddresses}
						onChange={setCcAddresses}
					/>
				) : (
					<div className="flex gap-2 pl-14">
						<button
							type="button"
							onClick={() => setShowCc(true)}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Cc
						</button>
						<button
							type="button"
							onClick={() => setShowBcc(true)}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Bcc
						</button>
					</div>
				)}
				{showCc && !showBcc && (
					<div className="pl-14">
						<button
							type="button"
							onClick={() => setShowBcc(true)}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Bcc
						</button>
					</div>
				)}
				{showBcc && (
					<AddressField
						label="Bcc"
						addresses={bccAddresses}
						onChange={setBccAddresses}
					/>
				)}
				<SubjectField value={subject} onChange={setSubject} />
			</div>

			<div className="flex-1 overflow-auto">
				<Suspense fallback={<ComposeBodyFallback />}>
					<LazyComposeBody
						value={body}
						onChange={setBody}
						onSubmit={handleSend}
						autoFocus={mode === "new"}
					/>
				</Suspense>
				{(quotedText || quotedHtml) && (
					<div className="px-3 pb-2">
						<QuotedText
							text={quotedText}
							html={quotedHtml}
							senderName={senderName}
						/>
					</div>
				)}
			</div>

			<ComposeActionBar
				onSend={handleSend}
				onDiscard={handleDiscard}
				isSending={isSending}
				canSend={canSend}
				saveStatus={saveStatus}
			/>
		</div>
	);
};
