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
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$insertNodes,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_LOW,
	HISTORY_PUSH_TAG,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
	PASTE_COMMAND,
} from "lexical";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { isWritingElsewhere } from "./editor-focus.js";
import { RichTextCorrectionMenu } from "./rich-text-correction-menu.js";
import { $adoptHtml, $readRichText } from "./rich-text-document.js";
import { RICH_TEXT_NODES, richTextTheme } from "./rich-text-nodes.js";
import type {
	CheckSpan,
	Finding,
	ProviderStatus,
	SpellcheckOptions,
	SpellProvider,
} from "./rich-text-spellcheck.js";
import { RichTextSpellcheckNotice } from "./rich-text-spellcheck-notice.js";
import {
	normaliseWord,
	SUGGESTION_LIMIT,
} from "./rich-text-spellcheck-words.js";
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

/** The characters a finding covers, as the browser draws them. */
const leafRange = (
	editor: LexicalEditor,
	key: string,
	start: number,
	end: number,
): Range | null => {
	const element = editor.getElementByKey(key);
	const characters = element ? leafCharacters(element) : null;
	if (!characters) return null;
	if (end > (characters.textContent?.length ?? 0)) return null;
	const range = characters.ownerDocument?.createRange();
	if (!range) return null;
	range.setStart(characters, start);
	range.setEnd(characters, end);
	return range;
};

/**
 * Where a pointer landed, in characters. `caretPositionFromPoint` is the
 * standard spelling and `caretRangeFromPoint` the one WebKit shipped; without
 * either, the browser has already moved the caret to the point and the
 * selection says where.
 */
interface CaretDocument {
	caretPositionFromPoint?(
		x: number,
		y: number,
	): { offsetNode: Node; offset: number } | null;
	caretRangeFromPoint?(x: number, y: number): Range | null;
}

const characterAt = (
	owner: Document,
	x: number,
	y: number,
): { node: Node; offset: number } | null => {
	const caret = owner as unknown as CaretDocument;
	const position = caret.caretPositionFromPoint?.(x, y);
	if (position) return { node: position.offsetNode, offset: position.offset };
	const range = caret.caretRangeFromPoint?.(x, y);
	if (range) return { node: range.startContainer, offset: range.startOffset };
	const selection = owner.getSelection();
	if (!selection?.focusNode) return null;
	return { node: selection.focusNode, offset: selection.focusOffset };
};

interface CorrectionTarget {
	readonly key: string;
	readonly start: number;
	readonly end: number;
	readonly word: string;
	/** Viewport-relative, straight off the word's own range — the menu portals
	 *  to the document body, so nothing here is relative to the editor. */
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
}

/**
 * A caret sits between characters and a pointer lands on one, so the two ask
 * different questions of the same range. The caret is inside the word from the
 * first character to just after the last — which is also what goes unmarked
 * while it is being written, so the chord opens exactly the word the squiggle
 * is being withheld from. A point belongs to a character, and the position
 * after the last one is already the space that follows.
 */
const coversCaret = (finding: Finding, offset: number): boolean =>
	offset > finding.start && offset <= finding.end;

const coversCharacter = (finding: Finding, offset: number): boolean =>
	offset >= finding.start && offset < finding.end;

/** How far a pointer may travel and still have been put down, not dragged. */
const TAP_SLOP_PX = 6;

/**
 * Drops what the session has been told to leave alone. Read against the text as
 * it stands now, so a word ignored at one place in the document loses its marks
 * everywhere it appears.
 */
const forgetIgnored = (
	editor: LexicalEditor,
	found: Map<string, readonly Finding[]>,
	ignored: ReadonlySet<string>,
): void => {
	editor.read(() => {
		for (const [key, findings] of found) {
			const node = $getNodeByKey(key);
			if (!$isTextNode(node)) continue;
			const text = node.getTextContent();
			const kept = findings.filter(
				(finding) =>
					!ignored.has(normaliseWord(text.slice(finding.start, finding.end))),
			);
			if (kept.length === findings.length) continue;
			if (kept.length === 0) {
				found.delete(key);
				continue;
			}
			found.set(key, kept);
		}
	});
};

/**
 * Marks and their corrections. Only the leaves an edit touched are sent, a
 * quarter of a second after the typing stops, so a word is not called wrong
 * while it is still being written — and the word the caret sits in is never
 * marked at all. An answer carrying a revision the document has moved past is
 * dropped.
 *
 * The marks live in the highlight registry, keyed by node key and rebuilt after
 * every reconciliation. Nothing enters the document, so history, the outgoing
 * HTML and the Markdown never see one.
 *
 * A click, a tap or the chord on a marked word opens the correction menu over
 * the findings already held here; the suggestions themselves are asked for one
 * word at a time, when the menu opens. The right button is left to the browser.
 */
const SpellcheckPlugin = ({
	language,
	options,
	hostRef,
	onReady,
}: {
	language: string;
	options: SpellcheckOptions;
	hostRef: RefObject<HTMLDivElement | null>;
	onReady: (ready: boolean) => void;
}) => {
	const [editor] = useLexicalComposerContext();
	const settings = useRef(options);
	const report = useRef(onReady);
	const found = useRef(new Map<string, readonly Finding[]>());
	// Session-scoped by construction: the set belongs to this mount and goes
	// with it, and nothing writes it anywhere (#707, decision 10).
	const ignored = useRef(new Set<string>());
	const checker = useRef<SpellProvider | null>(null);
	const repaint = useRef<() => void>(() => {});
	const asked = useRef(0);
	const [target, setTarget] = useState<CorrectionTarget | null>(null);
	const [suggestions, setSuggestions] = useState<readonly string[] | null>(
		null,
	);
	const [failure, setFailure] = useState<string | null>(null);
	// A cancelled download and a retry are the same effect run again, so the
	// attempt is what the effect keys off; standing down withholds the run.
	const [attempt, setAttempt] = useState(0);
	const [standDown, setStandDown] = useState(false);
	const [status, setStatus] = useState<ProviderStatus>({
		state: "opening",
		language,
		bytesLoaded: 0,
		bytesTotal: 0,
	});
	// Nothing here can draw a mark without the highlight registry, so there is
	// nothing to narrate either: the browser has the text to itself.
	const [drawable] = useState(marksSupported);

	useEffect(() => {
		settings.current = options;
		report.current = onReady;
	}, [options, onReady]);

	useEffect(() => {
		if (!marksSupported() || standDown) return;
		const painter = Symbol(SPELLCHECK_HIGHLIGHT);
		const findings = found.current;
		const touched = new Set<string>();
		let unsubscribe: (() => void) | undefined;
		let idle: ReturnType<typeof setTimeout> | undefined;
		let live = true;
		let state: ProviderStatus["state"] = "opening";
		let revision = 0;
		let passes = 0;
		let pressed: { x: number; y: number } | null = null;
		// The caret withholds the mark of the word it sits in, so a word is not
		// called wrong while it is still being written. A caret a pointer put
		// down is reading rather than writing: a click on a squiggle is how the
		// corrections open, and it must not take the squiggle with it. The next
		// key is the writer back at the text, and the withholding with them.
		let pointed = false;

		const paint = (): void => {
			const ranges: Range[] = [];
			editor.read(() => {
				const selection = $getSelection();
				const caret =
					!pointed && $isRangeSelection(selection) && selection.isCollapsed()
						? selection.anchor
						: null;
				for (const [key, spanFindings] of findings) {
					const node = $getNodeByKey(key);
					if (!$isTextNode(node)) {
						findings.delete(key);
						continue;
					}
					for (const finding of spanFindings) {
						if (caret?.key === key && coversCaret(finding, caret.offset))
							continue;
						const range = leafRange(editor, key, finding.start, finding.end);
						if (range) ranges.push(range);
					}
				}
			});
			paintMarks(painter, ranges);
		};
		repaint.current = paint;

		const check = (): void => {
			// Anything queued while the provider is not answering stays queued: the
			// next status that says ready sends it.
			const provider = checker.current;
			if (!provider || state !== "ready") return;
			const keys = [...touched];
			touched.clear();
			const spans: CheckSpan[] = [];
			editor.read(() => {
				for (const key of keys) {
					const node = $getNodeByKey(key);
					if (!$isTextNode(node)) {
						findings.delete(key);
						continue;
					}
					spans.push({ spanId: key, text: node.getTextContent() });
				}
			});
			if (spans.length === 0) {
				paint();
				return;
			}
			passes += 1;
			const sent = revision;
			provider
				// The attempt is part of the id, so a retry's answers are legible
				// against the ones the download it replaced never delivered.
				.check({
					requestId: `${attempt}:${passes}`,
					language,
					revision: sent,
					spans,
				})
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
					const texts = new Map(spans.map((span) => [span.spanId, span.text]));
					const grouped = new Map<string, Finding[]>();
					for (const finding of response.findings) {
						const text = texts.get(finding.spanId);
						if (!text) continue;
						const word = text.slice(finding.start, finding.end);
						if (ignored.current.has(normaliseWord(word))) continue;
						const list = grouped.get(finding.spanId);
						if (list) {
							list.push(finding);
							continue;
						}
						grouped.set(finding.spanId, [finding]);
					}
					for (const span of spans) findings.delete(span.spanId);
					for (const [key, spanFindings] of grouped)
						findings.set(key, spanFindings);
					paint();
				});
		};

		const schedule = (): void => {
			clearTimeout(idle);
			idle = setTimeout(check, SPELLCHECK_IDLE_MS);
		};

		const openAt = (
			key: string,
			offset: number,
			covers: (finding: Finding, offset: number) => boolean,
		): boolean => {
			const hit = (findings.get(key) ?? []).find((finding) =>
				covers(finding, offset),
			);
			// The editor still has to be mounted for a click on its own text to mean
			// anything, even though the menu itself no longer anchors to it.
			if (!hit || !hostRef.current) return false;
			const range = leafRange(editor, key, hit.start, hit.end);
			const word = editor.read(() => {
				const node = $getNodeByKey(key);
				if (!$isTextNode(node)) return "";
				return node.getTextContent().slice(hit.start, hit.end);
			});
			if (!range || !word) return false;
			const box = range.getBoundingClientRect();
			setTarget({
				key,
				start: hit.start,
				end: hit.end,
				word,
				left: box.left,
				right: box.right,
				top: box.top,
				bottom: box.bottom,
			});
			return true;
		};

		const openAtPoint = (x: number, y: number): boolean => {
			const owner = editor.getRootElement()?.ownerDocument;
			if (!owner) return false;
			const character = characterAt(owner, x, y);
			if (!character) return false;
			const key = editor.read(() => {
				const node = $getNearestNodeFromDOMNode(character.node);
				return $isTextNode(node) ? node.getKey() : null;
			});
			if (!key) return false;
			return openAt(key, character.offset, coversCharacter);
		};

		const onPointerDown = (event: PointerEvent) => {
			pointed = true;
			// The right button belongs to the browser's own menu, and a middle
			// click is a paste on the platforms that have one.
			pressed =
				event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
		};

		/**
		 * A pointer put down on a marked word and lifted where it landed, whether
		 * it was a finger or a mouse. A press that travelled was dragging out a
		 * selection, and a menu over the top of what it just selected is the one
		 * thing it must not get.
		 */
		const onPointerUp = (event: PointerEvent) => {
			const from = pressed;
			pressed = null;
			if (!from) return;
			if (
				Math.abs(event.clientX - from.x) > TAP_SLOP_PX ||
				Math.abs(event.clientY - from.y) > TAP_SLOP_PX
			)
				return;
			const selection = editor.getRootElement()?.ownerDocument.getSelection();
			if (selection && !selection.isCollapsed) return;
			openAtPoint(event.clientX, event.clientY);
		};

		const onPointerCancel = () => {
			pressed = null;
		};

		/**
		 * Whatever the key turns out to do — walk the caret, or write a character
		 * — it is the writer taking the text back, so the word under the caret
		 * goes quiet again. The repaint is here rather than left to the edit: a
		 * caret walked across a marked word makes no edit at all.
		 */
		const onKeyDown = () => {
			if (!pointed) return;
			pointed = false;
			paint();
		};

		const unbindRoot = editor.registerRootListener((next, previous) => {
			previous?.removeEventListener("pointerdown", onPointerDown);
			previous?.removeEventListener("pointerup", onPointerUp);
			previous?.removeEventListener("pointercancel", onPointerCancel);
			previous?.removeEventListener("keydown", onKeyDown);
			next?.addEventListener("pointerdown", onPointerDown);
			next?.addEventListener("pointerup", onPointerUp);
			next?.addEventListener("pointercancel", onPointerCancel);
			next?.addEventListener("keydown", onKeyDown);
		});

		// The keyboard's way in. The word under the caret is deliberately
		// unmarked, so this is the one path that has to read it anyway.
		const unbindChord = editor.registerCommand(
			KEY_DOWN_COMMAND,
			(event) => {
				if (!(event.metaKey || event.ctrlKey) || event.key !== ".")
					return false;
				const at = editor.read(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection) || !selection.isCollapsed())
						return null;
					return {
						key: selection.anchor.key,
						offset: selection.anchor.offset,
					};
				});
				if (!at || !openAt(at.key, at.offset, coversCaret)) return false;
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_LOW,
		);

		const unregister = editor.registerUpdateListener(({ dirtyLeaves }) => {
			if (dirtyLeaves.size === 0) {
				paint();
				return;
			}
			revision += 1;
			// An edit is writing whatever put the caret there, including a paste
			// or a correction, neither of which arrives on a key.
			pointed = false;
			// The menu is about a word at an offset, and both have just moved.
			setTarget(null);
			// Characters moved under the findings this leaf carries, so they are
			// answers about text that is no longer there. They go now rather than
			// sitting over the wrong letters until the next answer arrives.
			for (const key of dirtyLeaves) {
				findings.delete(key);
				touched.add(key);
			}
			paint();
			schedule();
		});

		const announce = (next: ProviderStatus): void => {
			setStatus(next);
			settings.current.onStatus?.(next);
		};

		const stopped = (detail: string): void => {
			announce({ state: "failed", language, reason: "worker", detail });
			report.current(false);
		};

		announce({ state: "opening", language, bytesLoaded: 0, bytesTotal: 0 });

		settings.current
			.provider(language)
			.then((opened) => {
				if (!live) {
					opened?.close();
					return;
				}
				checker.current = opened;
				if (!opened) {
					announce({ state: "unavailable", language });
					report.current(false);
					return;
				}
				unsubscribe = opened.onStatus((status) => {
					state = status.state;
					announce(status);
					const ready = status.state === "ready";
					report.current(ready);
					if (ready) {
						schedule();
						return;
					}
					// A dictionary on its way is not checking stopped, and it arrives in
					// twenty progress reports: treating each as a stop would empty the
					// queue the first pass is supposed to drain, and nothing would ever
					// be checked.
					if (status.state === "opening") return;
					// Checking stopped, so the browser's own is back. Its squiggles are
					// the only ones on screen from here.
					findings.clear();
					touched.clear();
					setTarget(null);
					paint();
				});
				// The document the editor opened on was reconciled before this
				// listener existed, so its leaves are checked here rather than waiting
				// for an edit that may never come.
				editor.read(() => {
					for (const node of $getRoot().getAllTextNodes())
						touched.add(node.getKey());
				});
				schedule();
			})
			.catch((error: unknown) => {
				if (!live) return;
				stopped(error instanceof Error ? error.message : String(error));
			});

		return () => {
			live = false;
			clearTimeout(idle);
			unregister();
			unbindRoot();
			unbindChord();
			unsubscribe?.();
			checker.current?.close();
			checker.current = null;
			findings.clear();
			setTarget(null);
			report.current(false);
			paintMarks(painter, []);
		};
	}, [editor, language, hostRef, attempt, standDown]);

	useEffect(() => {
		if (!target) return;
		setSuggestions(null);
		setFailure(null);
		const provider = checker.current;
		if (!provider) {
			setFailure("the checker is not running");
			return;
		}
		let live = true;
		asked.current += 1;
		provider
			.suggest({
				requestId: `suggest-${asked.current}`,
				language,
				word: target.word,
			})
			.then((answer) => {
				if (live) setSuggestions(answer.suggestions.slice(0, SUGGESTION_LIMIT));
			})
			.catch((error: unknown) => {
				if (!live) return;
				setFailure(error instanceof Error ? error.message : String(error));
			});
		return () => {
			live = false;
		};
	}, [target, language]);

	const dismiss = useCallback(
		(returnFocus: boolean) => {
			setTarget(null);
			// `editor.focus()` alone only moves the DOM caret when Lexical's own
			// selection model already matches the live DOM selection; the caret
			// the click left behind rarely does, and setting a Selection range
			// inside a contenteditable is not itself what moves focus there. The
			// explicit call is what actually lands the caret back in the message.
			if (returnFocus) {
				editor.focus();
				editor.getRootElement()?.focus();
			}
		},
		[editor],
	);

	const forget = useCallback(
		(word: string) => {
			ignored.current.add(normaliseWord(word));
			forgetIgnored(editor, found.current, ignored.current);
			repaint.current();
			dismiss(true);
		},
		[editor, dismiss],
	);

	const replace = (suggestion: string) => {
		if (!target) return;
		// One entry, so one undo puts the misspelling back (#707, decision 9).
		editor.update(
			() => {
				const node = $getNodeByKey(target.key);
				if (!$isTextNode(node)) return;
				// The offsets were read when the menu opened. An edit that landed
				// between then and the click has moved them, and writing there would
				// put the correction through the middle of a different word.
				if (
					node.getTextContent().slice(target.start, target.end) !== target.word
				)
					return;
				const written = node.spliceText(
					target.start,
					target.end - target.start,
					suggestion,
				);
				const caret = target.start + suggestion.length;
				written.select(caret, caret);
			},
			{ tag: HISTORY_PUSH_TAG },
		);
		dismiss(true);
	};

	const addWord = () => {
		if (!target) return;
		settings.current.onAddWord?.(target.word);
		forget(target.word);
	};

	return (
		<>
			{drawable ? (
				<RichTextSpellcheckNotice
					status={status}
					standDown={standDown}
					onCancel={() => setStandDown(true)}
					onRetry={() => {
						setStandDown(false);
						setAttempt((run) => run + 1);
					}}
				/>
			) : null}
			{target ? (
				<RichTextCorrectionMenu
					word={target.word}
					suggestions={suggestions}
					failure={failure}
					anchor={{
						left: target.left,
						right: target.right,
						top: target.top,
						bottom: target.bottom,
					}}
					language={language}
					onReplace={replace}
					onIgnore={() => forget(target.word)}
					onAddWord={options.onAddWord ? addWord : undefined}
					onDismiss={dismiss}
				/>
			) : null}
		</>
	);
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
			if (isWritingElsewhere(editor.getRootElement())) return;
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
	const bodyRef = useRef<HTMLDivElement>(null);

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
				<div ref={bodyRef} className="relative flex shrink-0 grow flex-col">
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
					{/* Inside the body's own box: the popover is placed against the
					    word's rect, and the sheet rises from the bottom of the writing
					    surface rather than the bottom of whatever page holds it. */}
					{spellcheck && lang ? (
						<SpellcheckPlugin
							language={lang}
							options={spellcheck}
							hostRef={bodyRef}
							onReady={setCheckedHere}
						/>
					) : null}
				</div>
			</div>
			<HistoryPlugin />
			<ListPlugin />
			<LinkPlugin />
			<TablePlugin />
			<PastePlugin />
			<AutoFocus caret={initialCaret} />
			{onChange && <ChangePlugin onChange={onChange} />}
		</LexicalComposer>
	);
};
