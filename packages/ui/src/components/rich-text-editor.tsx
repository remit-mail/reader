import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { mergeRegister } from "@lexical/utils";
import {
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$insertNodes,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_LOW,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
	PASTE_COMMAND,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import { $adoptHtml, $readRichText } from "./rich-text-document.js";
import { RICH_TEXT_NODES, richTextTheme } from "./rich-text-nodes.js";
import type {
	CheckSpan,
	Finding,
	ProviderStatus,
	SpellcheckOptions,
	SpellProvider,
} from "./rich-text-spellcheck.js";
import { RichTextToolbar } from "./rich-text-toolbar.js";
import type { ComposeCaret, RichTextValue } from "./rich-text-value.js";

export interface RichTextEditorProps {
	/**
	 * The document the editor opens on. Read once — reopen a different document
	 * by remounting under a different `key`.
	 */
	initialHtml?: string;
	onChange?: (value: RichTextValue) => void;
	onSubmit?: () => void;
	/**
	 * Where the caret lands when the surface takes focus on mount. Absent, it
	 * does not take focus. A message opens at the start, because a signature is
	 * already in the document and typing belongs above it; a surface arriving
	 * from a mode switch opens at the end, where the writing stopped.
	 */
	initialCaret?: ComposeCaret;
	placeholder?: string;
	ariaLabel?: string;
	/** Pinned to the right of the toolbar strip. The mode toggle rides here. */
	trailing?: React.ReactNode;
	/**
	 * BCP 47 tag of the language the message is being written in. Firefox picks
	 * a dictionary from it among the ones the user installed; Chrome and Safari
	 * ignore it. Every screen reader picks a voice from it.
	 */
	lang?: string;
	/**
	 * Where checking comes from. Left out, the browser does its own and the
	 * editor behaves as it does today. The engine is injected: this component
	 * never imports one, and a `provider` resolving null means no dictionary for
	 * `lang`, which is also when the browser keeps checking.
	 */
	spellcheck?: SpellcheckOptions;
}

/**
 * Adopted HTML enters the document as structure, never as characters. Without
 * this, a clipboard whose only markup lives in its text flavour puts the source
 * of a web page into the message (#671).
 *
 * `Shift` on the paste keystroke selects the text flavour, matching Gmail and
 * Apple Mail. The clipboard event carries no modifier state, so the keystroke
 * that triggered it is what records the intent.
 */
const PastePlugin = () => {
	const [editor] = useLexicalComposerContext();
	const plainRequested = useRef(false);

	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					KEY_DOWN_COMMAND,
					(event) => {
						if (
							(event.metaKey || event.ctrlKey) &&
							event.key.toLowerCase() === "v"
						) {
							plainRequested.current = event.shiftKey;
						}
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						// Lexical raises this command for `beforeinput` too, so the
						// modifier is read only once the event carrying the clipboard has
						// arrived — anything else would consume the intent.
						if (!(event instanceof ClipboardEvent)) return false;
						const clipboard = event.clipboardData;
						if (!clipboard) return false;
						const wasPlainRequested = plainRequested.current;
						plainRequested.current = false;

						if (wasPlainRequested) {
							const selection = $getSelection();
							if (!$isRangeSelection(selection)) return false;
							event.preventDefault();
							selection.insertRawText(clipboard.getData("text/plain"));
							return true;
						}

						const html = clipboard.getData("text/html");
						if (!html) return false;

						event.preventDefault();
						$insertNodes($adoptHtml(editor, html));
						return true;
					},
					COMMAND_PRIORITY_CRITICAL,
				),
			),
		[editor],
	);

	return null;
};

/**
 * Reports the document on mount as well as on every edit. What the caller
 * handed in as `initialHtml` is not what the editor holds — it has been through
 * the paste profile and Lexical's own import — so a caller that assumed
 * otherwise would autosave a body the composer is not showing.
 */
const ChangePlugin = ({
	onChange,
}: {
	onChange: (value: RichTextValue) => void;
}) => {
	const [editor] = useLexicalComposerContext();
	const report = useRef(onChange);

	useEffect(() => {
		report.current = onChange;
	}, [onChange]);

	useEffect(() => {
		const emit = () => report.current(editor.read(() => $readRichText(editor)));
		emit();
		return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
			if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
			emit();
		});
	}, [editor]);

	return null;
};

const SPELLCHECK_IDLE_MS = 250;
const SPELLCHECK_HIGHLIGHT = "spell-error";

interface SpellMarks {
	add(range: Range): void;
}

interface MarkRegistry {
	set(name: string, marks: SpellMarks): void;
	delete(name: string): void;
}

/**
 * The registry is read off the global rather than through the DOM typings,
 * which describe `Highlight` without the members that put a range in it. Where
 * a browser has neither, nothing is drawn and the provider is never opened.
 */
interface MarkHost {
	CSS?: { highlights?: MarkRegistry };
	Highlight?: new () => SpellMarks;
}

const markHost = (): MarkHost => globalThis as unknown as MarkHost;

const marksSupported = (): boolean => {
	const host = markHost();
	return Boolean(host.CSS?.highlights) && typeof host.Highlight === "function";
};

/**
 * One registry entry carries the marks of every editor on the page, because a
 * highlight name is a page-wide thing and `::highlight(spell-error)` names it
 * statically. Each editor owns its own ranges here and hands over the whole set
 * each pass, so a second composer neither overwrites the first nor takes its
 * marks down when it closes.
 */
const painters = new Map<symbol, readonly Range[]>();

const paintMarks = (painter: symbol, ranges: readonly Range[]): void => {
	const host = markHost();
	const registry = host.CSS?.highlights;
	const Marks = host.Highlight;
	if (!registry || !Marks) return;
	if (ranges.length === 0) painters.delete(painter);
	else painters.set(painter, ranges);

	const marks = new Marks();
	let drawn = 0;
	for (const owned of painters.values())
		for (const range of owned) {
			marks.add(range);
			drawn += 1;
		}
	if (drawn === 0) {
		registry.delete(SPELLCHECK_HIGHLIGHT);
		return;
	}
	registry.set(SPELLCHECK_HIGHLIGHT, marks);
};

/**
 * The characters of a leaf. A format Lexical renders with a tag of its own —
 * code, subscript, superscript — puts the text one level further down, so the
 * element the node key resolves to is not always the text itself.
 */
const leafCharacters = (node: Node): Node | null => {
	if (node.nodeType === Node.TEXT_NODE) return node;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		const characters = leafCharacters(child);
		if (characters) return characters;
	}
	return null;
};

/**
 * Marks, and nothing else. Only the leaves an edit touched are sent, a quarter
 * of a second after the typing stops, so a word is not called wrong while it is
 * still being written — and the word the caret sits in is never marked at all.
 * An answer carrying a revision the document has moved past is dropped.
 *
 * The marks live in the highlight registry, keyed by node key and rebuilt after
 * every reconciliation. Nothing enters the document, so history, the outgoing
 * HTML and the Markdown never see one.
 */
const SpellcheckPlugin = ({
	language,
	options,
	onReady,
}: {
	language: string;
	options: SpellcheckOptions;
	onReady: (ready: boolean) => void;
}) => {
	const [editor] = useLexicalComposerContext();
	const settings = useRef(options);
	const report = useRef(onReady);

	useEffect(() => {
		settings.current = options;
		report.current = onReady;
	}, [options, onReady]);

	useEffect(() => {
		if (!marksSupported()) return;
		const painter = Symbol(SPELLCHECK_HIGHLIGHT);
		const found = new Map<string, readonly Finding[]>();
		const touched = new Set<string>();
		let provider: SpellProvider | null = null;
		let unsubscribe: (() => void) | undefined;
		let idle: ReturnType<typeof setTimeout> | undefined;
		let live = true;
		let state: ProviderStatus["state"] = "opening";
		let revision = 0;
		let asked = 0;

		const repaint = (): void => {
			const ranges: Range[] = [];
			editor.read(() => {
				const selection = $getSelection();
				const caret =
					$isRangeSelection(selection) && selection.isCollapsed()
						? selection.anchor
						: null;
				for (const [key, findings] of found) {
					const node = $getNodeByKey(key);
					if (!$isTextNode(node)) {
						found.delete(key);
						continue;
					}
					const element = editor.getElementByKey(key);
					const text = element ? leafCharacters(element) : null;
					if (!text) continue;
					const length = text.textContent?.length ?? 0;
					for (const finding of findings) {
						if (finding.end > length) continue;
						if (
							caret?.key === key &&
							caret.offset > finding.start &&
							caret.offset <= finding.end
						)
							continue;
						const range = text.ownerDocument?.createRange();
						if (!range) continue;
						range.setStart(text, finding.start);
						range.setEnd(text, finding.end);
						ranges.push(range);
					}
				}
			});
			paintMarks(painter, ranges);
		};

		const check = (): void => {
			// Anything queued while the provider is not answering stays queued: the
			// next status that says ready sends it.
			if (!provider || state !== "ready") return;
			const keys = [...touched];
			touched.clear();
			const spans: CheckSpan[] = [];
			editor.read(() => {
				for (const key of keys) {
					const node = $getNodeByKey(key);
					if (!$isTextNode(node)) {
						found.delete(key);
						continue;
					}
					spans.push({ spanId: key, text: node.getTextContent() });
				}
			});
			if (spans.length === 0) {
				repaint();
				return;
			}
			asked += 1;
			const sent = revision;
			provider
				.check({ requestId: `${asked}`, language, revision: sent, spans })
				.then((response) => {
					if (!live) return;
					// The text moved while this was in flight, so the offsets are
					// answers to a document that no longer exists. The leaves go back
					// on the queue: dropping them here would leave them unchecked
					// until the writer happened to touch them again.
					if (response.revision !== revision) {
						for (const span of spans) touched.add(span.spanId);
						schedule();
						return;
					}
					const grouped = new Map<string, Finding[]>();
					for (const finding of response.findings) {
						const list = grouped.get(finding.spanId);
						if (list) {
							list.push(finding);
							continue;
						}
						grouped.set(finding.spanId, [finding]);
					}
					for (const span of spans) found.delete(span.spanId);
					for (const [key, findings] of grouped) found.set(key, findings);
					repaint();
				});
		};

		const schedule = (): void => {
			clearTimeout(idle);
			idle = setTimeout(check, SPELLCHECK_IDLE_MS);
		};

		const unregister = editor.registerUpdateListener(({ dirtyLeaves }) => {
			if (dirtyLeaves.size === 0) {
				repaint();
				return;
			}
			revision += 1;
			// Characters moved under the findings this leaf carries, so they are
			// answers about text that is no longer there. They go now rather than
			// sitting over the wrong letters until the next answer arrives.
			for (const key of dirtyLeaves) {
				found.delete(key);
				touched.add(key);
			}
			repaint();
			schedule();
		});

		settings.current.provider(language).then((opened) => {
			if (!live) {
				opened?.close();
				return;
			}
			provider = opened;
			if (!opened) {
				settings.current.onStatus?.({ state: "unavailable", language });
				report.current(false);
				return;
			}
			unsubscribe = opened.onStatus((status) => {
				state = status.state;
				settings.current.onStatus?.(status);
				const ready = status.state === "ready";
				report.current(ready);
				if (ready) {
					schedule();
					return;
				}
				// Checking stopped, so the browser's own is back. Its squiggles are
				// the only ones on screen from here.
				found.clear();
				touched.clear();
				repaint();
			});
			// The document the editor opened on was reconciled before this
			// listener existed, so its leaves are checked here rather than waiting
			// for an edit that may never come.
			editor.read(() => {
				for (const node of $getRoot().getAllTextNodes())
					touched.add(node.getKey());
			});
			schedule();
		});

		return () => {
			live = false;
			clearTimeout(idle);
			unregister();
			unsubscribe?.();
			provider?.close();
			provider = null;
			report.current(false);
			paintMarks(painter, []);
		};
	}, [editor, language]);

	return null;
};

const AutoFocus = ({ caret }: { caret?: ComposeCaret }) => {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (!caret) return;
		// Seeding the document leaves a selection behind at the end of what was
		// inserted, and `defaultSelection` only applies where there is none — so
		// the caret is placed here rather than left to `focus`, which would open a
		// new message below the signature instead of above it.
		const timer = setTimeout(() => {
			editor.update(
				() => {
					const root = $getRoot();
					if (caret === "start") {
						root.selectStart();
						return;
					}
					root.selectEnd();
				},
				{ onUpdate: () => editor.focus() },
			);
		}, 0);
		return () => clearTimeout(timer);
	}, [editor, caret]);

	return null;
};

const seedDocument =
	(html: string) =>
	(editor: LexicalEditor): void => {
		const nodes = $adoptHtml(editor, html);
		if (nodes.length === 0) return;
		$getRoot().select();
		$insertNodes(nodes);
	};

export const RichTextEditor = ({
	initialHtml,
	onChange,
	onSubmit,
	initialCaret,
	placeholder = "Write your message…",
	ariaLabel = "Message body",
	trailing,
	lang,
	spellcheck,
}: RichTextEditorProps) => {
	const [checkedHere, setCheckedHere] = useState(false);

	return (
		<LexicalComposer
			initialConfig={{
				namespace: "compose",
				nodes: RICH_TEXT_NODES,
				theme: richTextTheme,
				editorState: initialHtml ? seedDocument(initialHtml) : undefined,
				onError: (error) => {
					throw error;
				},
			}}
		>
			{/* The editable claims the height its container offers rather than only the
			    height of its own text. What is under the last line is the document, so
			    a click there reaches it instead of an unfocusable parent. */}
			<div className="flex shrink-0 grow flex-col">
				<RichTextToolbar trailing={trailing} />
				<div className="relative flex shrink-0 grow flex-col">
					<RichTextPlugin
						contentEditable={
							<ContentEditable
								lang={lang}
								/* Two sets of squiggles never coexist: the browser stops
								   checking exactly while a provider of ours is ready, and
								   checks again the moment one is not. */
								spellCheck={spellcheck ? !checkedHere : undefined}
								aria-label={ariaLabel}
								aria-placeholder={placeholder}
								data-testid="compose-body"
								className="min-h-[120px] w-full shrink-0 grow bg-canvas px-3 py-2 text-sm text-fg outline-none"
								placeholder={
									<div className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2 text-sm text-fg-subtle">
										{placeholder}
									</div>
								}
								onKeyDown={(event) => {
									if (!onSubmit) return;
									if (
										!(event.metaKey || event.ctrlKey) ||
										event.key !== "Enter"
									)
										return;
									event.preventDefault();
									onSubmit();
								}}
							/>
						}
						ErrorBoundary={LexicalErrorBoundary}
					/>
				</div>
			</div>
			<HistoryPlugin />
			<ListPlugin />
			<LinkPlugin />
			<TablePlugin />
			<PastePlugin />
			<AutoFocus caret={initialCaret} />
			{onChange && <ChangePlugin onChange={onChange} />}
			{spellcheck && lang ? (
				<SpellcheckPlugin
					language={lang}
					options={spellcheck}
					onReady={setCheckedHere}
				/>
			) : null}
		</LexicalComposer>
	);
};
