import {
	configOperationsGetConfigOptions,
	outboxDetailOperationsDeleteOutboxMessageMutation,
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxDetailOperationsSendOutboxMessageMutation,
	outboxOperationsCreateOutboxMessageMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { ComposeActionBar, ComposeFormShell, QuotedText } from "@remit/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Value } from "platejs";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useMessageBodyContent } from "../../hooks/useMessageBodyContent";
import { useSaveDraft } from "../../hooks/useSaveDraft";
import { useSignature } from "../../hooks/useSignature.js";
import {
	plateValueToHtml,
	plateValueToText,
} from "../../lib/plate-serializer.js";
import { accountIsMissingSmtp } from "../settings/account-form-helpers.js";
import { useErrorBanners } from "../ui/ErrorBannerProvider.js";
import {
	buildMutationErrorBanner,
	formatErrorDetail,
} from "../ui/error-banners.js";
import type { AddressEntry } from "./AddressField";
import { AddressField } from "./AddressField";
import { ComposeSmtpMissingBanner } from "./ComposeSmtpMissingBanner";

const LazyComposeBody = lazy(() =>
	import("./ComposeBody.js").then((m) => ({ default: m.ComposeBody })),
);

const ComposeBodyFallback = () => (
	<div className="min-h-[120px] px-3 py-2">
		<div className="h-8 mb-2 rounded bg-surface-sunken animate-pulse" />
		<div className="min-h-[80px] rounded bg-surface-sunken/50 animate-pulse" />
	</div>
);

import { useIsDesktop } from "../../hooks/useMediaQuery.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import type { ComposeMode } from "./ComposeProvider";
import { useCompose } from "./ComposeProvider";
import { FromSelector } from "./FromSelector";
import { SubjectField } from "./SubjectField";
import { sanitizeQuoteHtml } from "./sanitize-quote-html.js";

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

// ---------------------------------------------------------------------------
// ComposeHeader — collapsed on mobile when the software keyboard is open
// ---------------------------------------------------------------------------

interface ComposeHeaderProps {
	selectedAccountId?: string;
	onAccountChange: (account: RemitImapAccountResponse) => void;
	toAddresses: AddressEntry[];
	setToAddresses: (v: AddressEntry[]) => void;
	ccAddresses: AddressEntry[];
	setCcAddresses: (v: AddressEntry[]) => void;
	bccAddresses: AddressEntry[];
	setBccAddresses: (v: AddressEntry[]) => void;
	showCc: boolean;
	setShowCc: (v: boolean) => void;
	showBcc: boolean;
	setShowBcc: (v: boolean) => void;
	subject: string;
	setSubject: (v: string) => void;
}

const ComposeHeader = ({
	selectedAccountId,
	onAccountChange,
	toAddresses,
	setToAddresses,
	ccAddresses,
	setCcAddresses,
	bccAddresses,
	setBccAddresses,
	showCc,
	setShowCc,
	showBcc,
	setShowBcc,
	subject,
	setSubject,
}: ComposeHeaderProps) => {
	const isDesktop = useIsDesktop();
	const { isKeyboardOpen } = useVisualViewport();
	const collapsed = !isDesktop && isKeyboardOpen;

	if (collapsed) {
		// Compact single-line summary when the keyboard eats vertical space
		const chips: string[] = [];
		if (toAddresses.length > 0)
			chips.push(
				`To: ${toAddresses.map((a) => a.displayName ?? a.email).join(", ")}`,
			);
		if (ccAddresses.length > 0) chips.push(`Cc: ${ccAddresses.length}`);
		if (bccAddresses.length > 0) chips.push(`Bcc: ${bccAddresses.length}`);
		if (subject) chips.push(subject);

		return (
			<div
				className="flex items-center gap-2 px-3 py-1.5 border-b border-line overflow-hidden"
				data-testid="compose-header-collapsed"
			>
				<span className="truncate text-xs text-fg-muted">
					{chips.length > 0 ? chips.join(" · ") : "…"}
				</span>
				<span className="shrink-0 inline-flex items-center justify-center rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-muted">
					…
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-1 px-3 py-2 border-b border-line">
			<FromSelector
				selectedAccountId={selectedAccountId}
				onSelect={onAccountChange}
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
						className="text-xs text-fg-muted hover:text-fg transition-colors"
					>
						Cc
					</button>
					<button
						type="button"
						onClick={() => setShowBcc(true)}
						className="text-xs text-fg-muted hover:text-fg transition-colors"
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
						className="text-xs text-fg-muted hover:text-fg transition-colors"
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
	);
};

export const ComposeForm = ({
	mode,
	account,
	sourceMessage,
	onClose,
	onAccountChange,
}: ComposeFormProps) => {
	const { state, setOutboxMessageId, startSendPolling } = useCompose();
	const { pushError } = useErrorBanners();
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
	const prevOutboxMessageIdRef = useRef<string | undefined>(outboxMessageId);

	// Reset form when the user switches to a different draft (outboxMessageId
	// changes while compose is already open). Without this, the previous draft's
	// fields stay visible and the new draft never loads because draftLoaded
	// remains true from the prior session (#536).
	useEffect(() => {
		if (prevOutboxMessageIdRef.current === outboxMessageId) return;
		prevOutboxMessageIdRef.current = outboxMessageId;
		if (!outboxMessageId) return;
		setToAddresses([]);
		setCcAddresses([]);
		setBccAddresses([]);
		setSubject("");
		setShowCc(false);
		setShowBcc(false);
		setBody(EMPTY_PARAGRAPH);
		setDraftLoaded(false);
	}, [outboxMessageId]);

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

	// Quoted reply/forward content lives at the per-part `contentUrl` since
	// #224 PR 3 — fetch it via the same hook MessageBody uses, and degrade
	// to an empty quote when nothing renderable exists (the user can still
	// attribute the reply manually).
	const isQuoting =
		mode === "reply" || mode === "reply_all" || mode === "forward";
	const { data: sourceBody } = useMessageBodyContent({
		messageId: sourceMessage?.message.messageId,
		bodyParts: sourceMessage?.bodyParts,
		enabled: isQuoting && !!sourceMessage,
	});

	const quotedText = sourceBody?.kind === "text" ? sourceBody.body : "";
	const quotedHtml =
		sourceBody?.kind === "html"
			? sanitizeQuoteHtml(sourceBody.body)
			: undefined;

	const senderName =
		sourceMessage?.envelope.from[0]?.displayName ??
		sourceMessage?.envelope.from[0]?.normalizedEmail;

	const { saveStatus, saveError, saveDraft, cancelAutoSave } = useSaveDraft({
		outboxMessageId,
		onDraftCreated: setOutboxMessageId,
	});

	// Auto-save runs on a debounce, so a failure has no inline call site to
	// surface it. Push the real error detail to a banner instead of leaving only
	// the muted "Save failed" status dot. A fatal 5xx also hits the global
	// escalation overlay via MutationCache.onError.
	useEffect(() => {
		if (!saveError) return;
		pushError({
			title: "Couldn't save draft",
			detail: formatErrorDetail(saveError) ?? "Saving the draft failed.",
		});
	}, [saveError, pushError]);

	const createMutation = useMutation(
		outboxOperationsCreateOutboxMessageMutation(),
	);

	const sendMutation = useMutation(
		outboxDetailOperationsSendOutboxMessageMutation(),
	);

	const deleteMutation = useMutation({
		...outboxDetailOperationsDeleteOutboxMessageMutation(),
		onError: (error) => {
			// Discard closes the dialog optimistically. A soft 4xx (409/404 the
			// draft is already gone) must not pass silently as success — surface a
			// banner. A fatal 5xx still escalates through MutationCache.onError.
			pushError(
				buildMutationErrorBanner(
					"Couldn't discard draft",
					"The draft wasn't discarded.",
					error,
				),
			);
		},
	});

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const selectedAccount = config?.accounts.find(
		(a) => a.accountId === selectedAccountId,
	);
	const selectedAccountMissingSmtp = selectedAccount
		? accountIsMissingSmtp(selectedAccount)
		: false;

	const isSending = createMutation.isPending || sendMutation.isPending;
	const canSend =
		toAddresses.length > 0 &&
		!!selectedAccountId &&
		!selectedAccountMissingSmtp;

	useEffect(() => {
		if (!selectedAccountId) return;
		// Don't autosave while a draft is still being loaded. The fields are mid-
		// population when opening an existing draft, or have just been blanked for
		// a draft switch (#535/#536). Saving now would either write the previous
		// draft's content to the new outboxMessageId or create a spurious duplicate.
		if (outboxMessageId && !draftLoaded) return;
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
		outboxMessageId,
		draftLoaded,
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

		let messageId = outboxMessageId;
		let createdThisAttempt = false;

		if (!messageId) {
			const textBody = plateValueToText(body);
			const htmlBody = plateValueToHtml(body);

			const outboxMessage = await createMutation
				.mutateAsync({
					body: {
						accountId: selectedAccountId,
						toAddresses: toAddresses.map((a) => a.email),
						ccAddresses:
							ccAddresses.length > 0
								? ccAddresses.map((a) => a.email)
								: undefined,
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
				})
				.catch((error: unknown) => {
					pushError({
						title: "Couldn't send message",
						detail: formatErrorDetail(error) ?? "Saving the draft failed.",
					});
					return null;
				});
			if (outboxMessage === null) return;
			messageId = outboxMessage.outboxMessageId;
			createdThisAttempt = true;
			setOutboxMessageId(messageId);
		}

		const sent = await sendMutation
			.mutateAsync({
				path: { outboxMessageId: messageId },
			})
			.catch((error: unknown) => {
				pushError({
					title: "Couldn't send message",
					detail:
						formatErrorDetail(error) ??
						(createdThisAttempt
							? "The draft was saved but the send request failed. Try again from the Outbox."
							: "The send request failed. Try again."),
				});
				return null;
			});
		if (sent === null) return;

		startSendPolling(messageId);
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
		startSendPolling,
		setOutboxMessageId,
		pushError,
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
		<ComposeFormShell
			banner={
				selectedAccount && selectedAccountMissingSmtp ? (
					<ComposeSmtpMissingBanner accountId={selectedAccount.accountId} />
				) : undefined
			}
			header={
				<ComposeHeader
					selectedAccountId={selectedAccountId}
					onAccountChange={handleAccountChange}
					toAddresses={toAddresses}
					setToAddresses={setToAddresses}
					ccAddresses={ccAddresses}
					setCcAddresses={setCcAddresses}
					bccAddresses={bccAddresses}
					setBccAddresses={setBccAddresses}
					showCc={showCc}
					setShowCc={setShowCc}
					showBcc={showBcc}
					setShowBcc={setShowBcc}
					subject={subject}
					setSubject={setSubject}
				/>
			}
			quoted={
				quotedText || quotedHtml ? (
					<QuotedText
						text={quotedText}
						html={quotedHtml}
						senderName={senderName}
					/>
				) : undefined
			}
			actionBar={
				<ComposeActionBar
					onSend={handleSend}
					onDiscard={handleDiscard}
					sending={isSending}
					canSend={canSend}
					saveStatus={saveStatus}
					unavailableReason={
						selectedAccountMissingSmtp ? "SMTP not configured" : undefined
					}
					onUnavailable={(reason) =>
						pushError({
							title: "Can't send yet",
							detail: reason,
						})
					}
				/>
			}
		>
			<Suspense fallback={<ComposeBodyFallback />}>
				<LazyComposeBody
					value={body}
					onChange={setBody}
					onSubmit={handleSend}
					autoFocus={mode === "new"}
				/>
			</Suspense>
		</ComposeFormShell>
	);
};
