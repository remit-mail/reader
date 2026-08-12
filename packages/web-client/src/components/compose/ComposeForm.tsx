import {
	configOperationsGetConfigOptions,
	outboxDetailOperationsDeleteOutboxMessageMutation,
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxDetailOperationsSendOutboxMessageMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	ComposeActionBar,
	ComposeBodySkeleton,
	ComposeFormShell,
	ComposeHeader,
	type ComposeSendState,
	type ComposeShellLayout,
	ComposeSubjectField,
	composeHeaderSummary,
	defaultComposeLanguages,
	modeOfDraft,
	QuotedText,
	type RichTextValue,
	SMTP_MISSING_MESSAGE,
	sanitizeQuotedHtml,
	unwrapLanguage,
	wrapWithLanguage,
} from "@remit/ui";
import type { ComposeBodyMode } from "@remit/ui/rich-text";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMessageBodyContent } from "../../hooks/useMessageBodyContent";
import { useSaveDraft } from "../../hooks/useSaveDraft";
import { useSignature } from "../../hooks/useSignature.js";
import { accountIsMissingSmtp } from "../settings/account-form-helpers.js";
import { useErrorBanners } from "../ui/ErrorBannerProvider.js";
import {
	buildMutationErrorBanner,
	formatErrorDetail,
} from "../ui/error-banners.js";
import type { AddressEntry } from "./AddressField";
import { AddressField } from "./AddressField";
import { ComposeSmtpMissingBanner } from "./ComposeSmtpMissingBanner";
import { composeSpellcheck } from "./compose-spellcheck.js";

const LazyComposeBody = lazy(() =>
	import("@remit/ui/rich-text").then((m) => ({ default: m.ComposeBody })),
);

import { useIsDesktop } from "../../hooks/useMediaQuery.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import type { ComposeMode } from "./ComposeProvider";
import { useCompose } from "./ComposeProvider";
import { FromSelector } from "./FromSelector";

interface ComposeFormProps {
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	/**
	 * The draft this composer writes to. Absent until there is one, and owned by
	 * whoever mounted the form — the address for the compose route, the inline
	 * composer's own state for a reply. A composer that read it from somewhere
	 * shared would open on the last draft any other composer touched.
	 */
	outboxMessageId?: string;
	/** The draft the first autosave created, for the owner to record. */
	onDraftCreated: (outboxMessageId: string) => void;
	onClose: () => void;
	onAccountChange?: (account: RemitImapAccountResponse) => void;
	/**
	 * How the surface takes its height. A window in its own pane fills that
	 * pane; one opened as a block of the conversation grows with what is written
	 * in it and leaves the pane the only scroller.
	 */
	layout?: ComposeShellLayout;
}

const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const textToHtml = (text: string): string =>
	text
		.split("\n")
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join("");

const buildInitialHtml = (signaturePlainText: string): string => {
	if (!signaturePlainText) return "";
	return `<p></p><p>-- </p>${textToHtml(signaturePlainText)}`;
};

/**
 * The document a new message opens on. One definition, because a form that
 * starts a second message without remounting has to open on the same thing the
 * first one did.
 */
const freshDocument = (
	signaturePlainText: string,
): { html: string; text: string } => ({
	html: buildInitialHtml(signaturePlainText),
	text: signaturePlainText,
});

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

/**
 * What the two body columns carry for this mode.
 *
 * Plain mode writes the empty string rather than omitting `htmlBody`: absent
 * means "leave alone" at every layer below, so a plain draft that omitted it
 * would send the HTML it was written as before the switch. The empty string is
 * defined, so the repository's update guard clears the column, and nodemailer
 * branches on the value being truthy — an empty one builds no HTML alternative
 * and the message leaves as a single `text/plain` part.
 *
 * Rich mode leaves it alone while it has nothing to say, so the moments before
 * the lazily-loaded editor reports its document cannot write a draft back as
 * plain.
 */
const outgoingBody = (
	bodyMode: ComposeBodyMode,
	body: RichTextValue,
	language: string,
): { textBody: string | undefined; htmlBody: string | undefined } => ({
	textBody: body.text || undefined,
	htmlBody:
		bodyMode === "plain"
			? ""
			: body.html
				? wrapWithLanguage(body.html, language)
				: undefined,
});

type SendReadiness =
	| { status: "sending" }
	| { status: "blocked"; reason: string }
	| { status: "ready"; accountId: string };

const isFormEmpty = (
	toAddresses: AddressEntry[],
	ccAddresses: AddressEntry[],
	bccAddresses: AddressEntry[],
	subject: string,
	body: RichTextValue,
): boolean =>
	toAddresses.length === 0 &&
	ccAddresses.length === 0 &&
	bccAddresses.length === 0 &&
	subject.trim() === "" &&
	body.text.trim() === "";

// ---------------------------------------------------------------------------
// WiredComposeHeader — the shared header, with the app's fields in its slots
// ---------------------------------------------------------------------------

interface WiredComposeHeaderProps {
	documentGeneration: number;
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

const WiredComposeHeader = ({
	documentGeneration,
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
}: WiredComposeHeaderProps) => {
	const isDesktop = useIsDesktop();
	const { isKeyboardOpen } = useVisualViewport();
	// What the user asked to see belongs to the document being written, not to
	// the keyboard. Tying it to the keyboard collapsed the rows again the moment
	// one came back up — over the recipient field being typed into, which took
	// the keyboard down with it and started the cycle over.
	const [expandedFor, setExpandedFor] = useState<number | undefined>(undefined);
	const expanded = expandedFor === documentGeneration;

	return (
		<ComposeHeader
			collapsed={!isDesktop && isKeyboardOpen && !expanded}
			onExpand={() => setExpandedFor(documentGeneration)}
			summary={composeHeaderSummary({
				to: toAddresses,
				cc: ccAddresses,
				bcc: bccAddresses,
				subject,
			})}
			from={
				<FromSelector
					selectedAccountId={selectedAccountId}
					onSelect={onAccountChange}
				/>
			}
			to={
				<AddressField
					label="To"
					addresses={toAddresses}
					onChange={setToAddresses}
					placeholder="Recipients"
				/>
			}
			cc={
				showCc ? (
					<AddressField
						label="Cc"
						addresses={ccAddresses}
						onChange={setCcAddresses}
					/>
				) : undefined
			}
			bcc={
				showBcc ? (
					<AddressField
						label="Bcc"
						addresses={bccAddresses}
						onChange={setBccAddresses}
					/>
				) : undefined
			}
			subject={<ComposeSubjectField value={subject} onChange={setSubject} />}
			onShowCc={() => setShowCc(true)}
			onShowBcc={() => setShowBcc(true)}
		/>
	);
};

export const ComposeForm = ({
	mode,
	account,
	sourceMessage,
	outboxMessageId,
	onDraftCreated,
	onClose,
	onAccountChange,
	layout = "fill",
}: ComposeFormProps) => {
	const { startSendPolling } = useCompose();
	const { pushError } = useErrorBanners();

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
	/**
	 * The document the fields on screen belong to. It trails `outboxMessageId`
	 * for one commit whenever the document changes, and autosave has to sit that
	 * commit out — the fields still hold the message that has just been left.
	 */
	const [openDocumentId, setOpenDocumentId] = useState(outboxMessageId);
	const smtpConfigureRef = useRef<HTMLButtonElement>(null);
	const prevOutboxMessageIdRef = useRef<string | undefined>(outboxMessageId);

	// The document this form is on changed under it, so it starts again: another
	// draft, or no draft at all. Without this the previous one's fields stay on
	// screen and the new one never loads, because `draftLoaded` is still true
	// from the session before (#536).
	//
	// "No draft at all" is Compose pressed while already composing — the address
	// drops the draft segment and the same route stays matched, so nothing
	// remounts the form. Leaving it alone there showed the old message under an
	// address that said new one, and the next autosave took the create branch
	// and wrote a second draft holding the first one's content.
	//
	// The one change that is not a different document is the first autosave
	// adopting the id it just created. That is this session's own content coming
	// back, and blanking the form there would throw away what is being typed.
	useEffect(() => {
		const previous = prevOutboxMessageIdRef.current;
		if (previous === outboxMessageId) return;
		prevOutboxMessageIdRef.current = outboxMessageId;
		if (previous === undefined) return;
		// A draft brings its own body along in a moment; a new message opens on
		// the signature, the same document a fresh mount would have started on.
		const opening = outboxMessageId
			? { html: "", text: "" }
			: freshDocument(signatureRef.current);
		setToAddresses([]);
		setCcAddresses([]);
		setBccAddresses([]);
		setSubject("");
		setShowCc(false);
		setShowBcc(false);
		setInitialHtml(opening.html);
		setInitialText(opening.text);
		setBodyMode("rich");
		setDraftLanguage(undefined);
		setBody({ ...opening, formatting: [] });
		setDocumentGeneration((generation) => generation + 1);
		setDraftLoaded(false);
		setOpenDocumentId(outboxMessageId);
	}, [outboxMessageId]);

	const { signature } = useSignature(selectedAccountId);
	// Read when a new message starts, never depended on: a signature arriving is
	// not a reason to reopen the document somebody is typing in.
	const signatureRef = useRef(signature.plainText);
	signatureRef.current = signature.plainText;
	// The editor reads its document once, so this is the document it opens on,
	// not the live value, and it is remounted when the generation changes. Only
	// loading a different document bumps that — remounting mid-compose would take
	// the caret, the focus and the undo history with it.
	const [documentGeneration, setDocumentGeneration] = useState(0);
	const [initialHtml, setInitialHtml] = useState(
		() => freshDocument(signature.plainText).html,
	);
	const [initialText, setInitialText] = useState(signature.plainText);
	const [bodyMode, setBodyMode] = useState<ComposeBodyMode>("rich");
	// What the body is tagged with on the way out. The composer owns the value —
	// it is the surface that has the text detection reads — and reports it here,
	// because this is where a draft is written and where a send is assembled.
	const [composeLanguage, setComposeLanguage] = useState("en");
	const [draftLanguage, setDraftLanguage] = useState<string | undefined>();
	const [body, setBody] = useState<RichTextValue>(() => ({
		...freshDocument(signature.plainText),
		formatting: [],
	}));

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
		// A draft stores what would have been sent, so which surface it reopens in
		// is read off that rather than a field of its own. A rich draft comes back
		// from its HTML — reading its text into one paragraph, as this did, brought
		// a formatted message back flattened.
		// A rich draft carries its language in the `<div lang>` it was stored
		// under; the editor reopens on what is inside that, so a reopened draft
		// does not gain a second wrapper on its next autosave. A plain draft has
		// no HTML to have carried one, and comes back on the account default.
		const stored = unwrapLanguage(draftData.htmlBody ?? "");
		const loadedHtml = stored.html;
		const loadedText = draftData.textBody ?? "";
		setBodyMode(modeOfDraft(draftData.htmlBody));
		setDraftLanguage(stored.language ?? undefined);
		setInitialHtml(loadedHtml);
		setInitialText(loadedText);
		setBody({ html: loadedHtml, text: loadedText, formatting: [] });
		setDocumentGeneration((generation) => generation + 1);
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
			? sanitizeQuotedHtml(sourceBody.body)
			: undefined;

	const senderName =
		sourceMessage?.envelope.from[0]?.displayName ??
		sourceMessage?.envelope.from[0]?.normalizedEmail;

	// The draft this session just created holds what is already on screen, so
	// there is nothing to read back — and reading it back would replace the
	// document under the caret with the server's copy of it.
	const adoptCreatedDraft = useCallback(
		(createdId: string) => {
			setDraftLoaded(true);
			// What is on screen is what was just written, so the fields belong to
			// the new draft the moment it exists — before the id has travelled out
			// through the address and back. Waiting for that would hold the next
			// autosave, and the last thing typed before a pause would not be saved.
			setOpenDocumentId(createdId);
			onDraftCreated(createdId);
		},
		[onDraftCreated],
	);

	const { saveStatus, saveError, saveDraft, saveImmediately, stopAutoSave } =
		useSaveDraft({
			outboxMessageId,
			onDraftCreated: adoptCreatedDraft,
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
			error: saveError,
		});
	}, [saveError, pushError]);

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

	// An account that has never been to the language setting falls back to what
	// the browser already knows the user reads, which is an ordered answer.
	const configured = selectedAccount?.composeLanguages;
	const accountLanguages = useMemo(
		() =>
			configured && configured.length > 0
				? configured
				: defaultComposeLanguages(navigator.languages),
		[configured],
	);

	// The editor reopens the checker whenever the composer's language changes,
	// so the tag the chip and detection settle on is the only one it is ever
	// asked for.
	const spellcheck = useMemo(() => composeSpellcheck(pushError), [pushError]);

	// The action bar refuses a second press while one is in flight, but the
	// editor's own Cmd+Enter goes straight to `attemptSend`, and the write that
	// now precedes the request widens the window a second press lands in.
	const sendInFlightRef = useRef(false);
	const [isSending, setIsSending] = useState(false);
	// Every refusal carries the sentence that explains it. Send is never a
	// no-op: the state it reads has no way to be blocked without a reason. A
	// ready state carries the account the message goes out from, so the send
	// path has no condition of its own left to refuse on in silence.
	const sendReadiness = useMemo<SendReadiness>(() => {
		if (isSending) return { status: "sending" };
		if (!selectedAccountId) {
			return { status: "blocked", reason: "Choose an account to send from." };
		}
		if (selectedAccountMissingSmtp) {
			return { status: "blocked", reason: SMTP_MISSING_MESSAGE };
		}
		if (toAddresses.length === 0) {
			return { status: "blocked", reason: "Add at least one recipient." };
		}
		return { status: "ready", accountId: selectedAccountId };
	}, [
		isSending,
		selectedAccountId,
		selectedAccountMissingSmtp,
		toAddresses.length,
	]);
	const sendState: ComposeSendState = sendReadiness;

	useEffect(() => {
		if (!selectedAccountId) return;
		// Don't autosave a document the fields are no longer on. They trail the
		// address by a commit whenever it changes, so writing here sends the
		// message just left to whatever the address now names — the previous
		// draft's content onto the next draft, or, with no draft named at all, a
		// spurious second one holding it (#535/#536).
		if (openDocumentId !== undefined && openDocumentId !== outboxMessageId)
			return;
		// Nor one still arriving: opening an existing draft leaves the fields
		// mid-population until the read lands.
		if (outboxMessageId && !draftLoaded) return;
		if (isFormEmpty(toAddresses, ccAddresses, bccAddresses, subject, body))
			return;

		const { htmlBody, textBody } = outgoingBody(
			bodyMode,
			body,
			composeLanguage,
		);

		saveDraft({
			accountId: selectedAccountId,
			toAddresses: toAddresses.map((a) => a.email),
			ccAddresses:
				ccAddresses.length > 0 ? ccAddresses.map((a) => a.email) : undefined,
			bccAddresses:
				bccAddresses.length > 0 ? bccAddresses.map((a) => a.email) : undefined,
			subject: subject || undefined,
			textBody,
			htmlBody,
		});
	}, [
		selectedAccountId,
		outboxMessageId,
		openDocumentId,
		draftLoaded,
		toAddresses,
		ccAddresses,
		bccAddresses,
		subject,
		body,
		bodyMode,
		composeLanguage,
		saveDraft,
	]);

	const handleSend = useCallback(
		async (accountId: string) => {
			if (sendInFlightRef.current) return;

			sendInFlightRef.current = true;
			setIsSending(true);
			try {
				stopAutoSave();

				const replyData =
					sourceMessage && (mode === "reply" || mode === "reply_all")
						? getReferences(sourceMessage)
						: {};

				const { htmlBody, textBody } = outgoingBody(
					bodyMode,
					body,
					composeLanguage,
				);
				const createdThisAttempt = !outboxMessageId;

				// The debounce dropped above may have been holding the last two seconds
				// of typing, and an existing entry would otherwise go out as the server
				// last saw it (#674). What is on screen is written first, and a write
				// that fails stops the send rather than transmitting the older copy.
				const flushed = await saveImmediately({
					accountId,
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
					textBody,
					htmlBody,
					...replyData,
				});

				if (flushed.outcome === "failed") {
					pushError({
						title: "Couldn't send message",
						detail:
							formatErrorDetail(flushed.error) ??
							"Saving the message failed, so nothing was sent. Try again.",
						error: flushed.error,
					});
					return;
				}

				const messageId = flushed.outboxMessageId;

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
							error,
						});
						return null;
					});
				if (sent === null) return;

				stopAutoSave(messageId);
				startSendPolling(messageId);
				onClose();
			} finally {
				sendInFlightRef.current = false;
				setIsSending(false);
			}
		},
		[
			toAddresses,
			ccAddresses,
			bccAddresses,
			subject,
			body,
			bodyMode,
			composeLanguage,
			mode,
			sourceMessage,
			outboxMessageId,
			saveImmediately,
			sendMutation,
			stopAutoSave,
			startSendPolling,
			pushError,
			onClose,
		],
	);

	const handleDiscard = useCallback(() => {
		stopAutoSave(outboxMessageId);
		if (outboxMessageId) {
			deleteMutation.mutate({
				path: { outboxMessageId },
			});
		}
		onClose();
	}, [stopAutoSave, outboxMessageId, deleteMutation, onClose]);

	// The refusal is announced first and moved to second. Focus alone carried
	// nothing to a screen reader — the banner above was already on screen, so
	// the press read as the button doing nothing.
	const reportBlocked = useCallback(
		(reason: string) => {
			pushError({ title: "Can't send yet", detail: reason });
			if (reason !== SMTP_MISSING_MESSAGE) return;
			smtpConfigureRef.current?.focus();
		},
		[pushError],
	);

	const attemptSend = useCallback(() => {
		if (sendReadiness.status === "sending") return;
		if (sendReadiness.status === "blocked") {
			reportBlocked(sendReadiness.reason);
			return;
		}
		void handleSend(sendReadiness.accountId);
	}, [sendReadiness, reportBlocked, handleSend]);

	const handleAccountChange = useCallback(
		(acct: RemitImapAccountResponse) => {
			setSelectedAccountId(acct.accountId);
			onAccountChange?.(acct);
		},
		[onAccountChange],
	);

	return (
		<ComposeFormShell
			layout={layout}
			banner={
				selectedAccount && selectedAccountMissingSmtp ? (
					<ComposeSmtpMissingBanner
						accountId={selectedAccount.accountId}
						configureRef={smtpConfigureRef}
					/>
				) : undefined
			}
			header={
				<WiredComposeHeader
					documentGeneration={documentGeneration}
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
					send={sendState}
					onSend={attemptSend}
					onBlocked={reportBlocked}
					onDiscard={handleDiscard}
					saveStatus={saveStatus}
				/>
			}
		>
			<Suspense fallback={<ComposeBodySkeleton />}>
				<LazyComposeBody
					key={documentGeneration}
					mode={bodyMode}
					onModeChange={setBodyMode}
					initialHtml={initialHtml}
					initialText={initialText}
					onChange={setBody}
					onSubmit={attemptSend}
					initialCaret={mode === "new" ? "start" : undefined}
					onConversionError={pushError}
					languages={accountLanguages}
					initialLanguage={draftLanguage}
					onLanguageChange={setComposeLanguage}
					spellcheck={spellcheck}
				/>
			</Suspense>
		</ComposeFormShell>
	);
};
