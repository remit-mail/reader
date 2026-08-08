import{r as M,j as S}from"./iframe-zw88L4Mq.js";import{C as F}from"./compose-body-DHeQJoUZ.js";import"./preload-helper-PPVm8Dsz.js";import"./compose-language-chip-CxLogOap.js";import"./cn-yMAG7bfM.js";import"./compose-language-CBWlIzAC.js";import"./roving-focus-5ii5MRPr.js";import"./button-B3Yk1mOK.js";import"./compose-mode-toggle-FDO1EiWK.js";import"./confirm-dialog-Bge_ICxX.js";import"./plain-text-editor-DHq8tFMc.js";import"./banner-zJdgs6dW.js";import"./x-BLGUIrqQ.js";import"./createLucideIcon-AdIgPHc_.js";import"./rich-text-document-CIrK6BXP.js";import"./purify.es-2FREwzWT.js";import"./rich-text-editor-DJjfbdVG.js";import"./index-CnSpV_wb.js";import"./index-C2f1Dkc0.js";import"./undo-2-DlL9RetS.js";const{expect:a,fn:L,userEvent:n,waitFor:x,within:s}=__STORYBOOK_MODULE_TEST__,C=["<h2>Quarterly numbers</h2>","<p>Revenue is <strong>up</strong> on the quarter.</p>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>"].join(""),A="<p>Thanks — that works.</p><p></p><p>See you then.</p>",_="<p>Please <u>read this</u> before Friday.</p>",R=["## Quarterly numbers","","| Region | Total |","| --- | --- |","| EMEA | 412 |"].join(`
`),N="<p>Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel voor de planning.</p>",U="Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel.",j=["nl","en","de"],W=()=>{},G=({initialHtml:e="",initialText:t="",startIn:r="rich",onConversionError:O=()=>{},conversions:P,languages:D=j,quoted:B})=>{const[q,I]=M.useState(r);return S.jsxs("div",{className:"flex h-[460px] w-[680px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:[S.jsx(F,{mode:q,onModeChange:I,initialHtml:e,initialText:t,onChange:()=>{},onConversionError:O,conversions:P,languages:D,onLanguageChange:W}),B&&S.jsx("blockquote",{"data-testid":"compose-quoted",lang:"fr",className:"border-l-2 border-line px-3 py-2 text-sm text-fg-muted",children:B})]})},i=e=>{const t=e.querySelector("[data-testid=compose-language-chip]");if(!t)throw new Error("the language chip is not mounted");return t},ue={title:"Mail/ComposeBody",component:G,parameters:{layout:"centered",docs:{description:{component:"The mode switch as the compose window runs it: the toolbar control, the one\nwarning it raises, and the two surfaces it swaps between. The live\n`ComposeForm` adds the recipients, the autosave and the send around this."}}}},o=e=>{const t=e.querySelector("[data-testid=compose-mode-toggle]");if(!t)throw new Error("the mode toggle is not mounted");return t},c=e=>e.querySelector("[data-testid=compose-body-plain]"),E={name:"Rich, with formatting",args:{initialHtml:C}},k={name:"Plain, reopened from Markdown",args:{startIn:"plain",initialText:R}},l={name:"The warning, cancelled",args:{initialHtml:C},play:async({canvasElement:e})=>{const t=o(e);await n.click(t);const r=s(document.body).getByRole("dialog");await a(r).toHaveTextContent("Switch to plain text?"),await a(r).toHaveTextContent("Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it."),await a(t).toHaveAttribute("aria-pressed","false"),await n.click(s(r).getByRole("button",{name:"Cancel"})),await a(c(e)).toBeNull(),await a(e.querySelector("[data-testid=compose-body] table")).not.toBeNull(),await a(o(e)).toHaveFocus()}},T={name:"The warning, confirmed",args:{initialHtml:C},play:async({canvasElement:e})=>{await n.click(o(e)),await n.click(s(s(document.body).getByRole("dialog")).getByRole("button",{name:"Switch to plain text"}));const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("## Quarterly numbers"),await a(t.value).toContain("**up**"),await a(t.value).toContain("| EMEA | 412 |"),await a(e.querySelector("[aria-label='Bold (Ctrl+B)']")).toBeNull(),await a(o(e)).toHaveAttribute("aria-pressed","true"),await a(t).toHaveFocus(),await a(t.selectionStart).toBe(t.value.length)}},d={name:"Plain paragraphs switch without asking",args:{initialHtml:A},play:async({canvasElement:e})=>{await n.click(o(e)),await a(s(document.body).queryByRole("dialog")).toBeNull();const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("Thanks"),await a(t.value).toContain("See you then.")}},u={name:"An underline alone still warns",args:{initialHtml:_},play:async({canvasElement:e})=>{await n.click(o(e)),await a(s(document.body).getByRole("dialog")).toHaveTextContent("Switch to plain text?")}},H={name:"Markdown back to rich, without asking",args:{startIn:"plain",initialText:R},play:async({canvasElement:e})=>{await n.click(o(e)),await a(s(document.body).queryByRole("dialog")).toBeNull();const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelector("h2")).not.toBeNull(),await a(t.querySelector("table td")).not.toBeNull()}},p={name:"Prose with no Markdown in it",args:{startIn:"plain",initialText:`Thanks — that works.

I'll send the deck tomorrow.`},play:async({canvasElement:e})=>{await n.click(o(e));const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelectorAll("p").length).toBe(2),await a(t.textContent).toContain("Thanks — that works."),await a(t.textContent).toContain("I'll send the deck tomorrow.")}},m={name:"A conversion that came back empty",args:{startIn:"plain",initialText:"Everything I wrote this morning.",onConversionError:L(),conversions:{toPlain:e=>e.text,toRich:()=>""}},play:async({args:e,canvasElement:t})=>{await n.click(o(t)),await a(e.onConversionError).toHaveBeenCalledWith({outcome:"blocked",title:"Couldn't switch to rich text",detail:"The conversion came back empty, so your message is unchanged."});const r=c(t);if(!r)throw new Error("the plain surface left");await a(r.value).toBe("Everything I wrote this morning."),await a(o(t)).toHaveAttribute("aria-pressed","true")}},h={name:"Shift+Tab from the body reaches it",args:{initialHtml:A},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await n.click(t),await n.tab({shift:!0}),await a(o(e)).toHaveFocus(),await n.keyboard("{Enter}"),await a(c(e)).not.toBeNull()}},w={name:"Dutch prose sets the chip",args:{initialHtml:N},play:async({canvasElement:e})=>{await x(async()=>{await a(i(e)).toHaveTextContent("NL")},{timeout:5e3}),await a(e.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang","nl")}},g={name:"Nine characters hold the default",args:{startIn:"plain"},play:async({canvasElement:e})=>{const t=c(e);if(!t)throw new Error("the plain surface is not mounted");await n.click(t),await n.keyboard("Hi Sophie"),await new Promise(r=>setTimeout(r,800)),await a(i(e)).toHaveTextContent("NL")}},y={name:"A picked language survives more typing",args:{startIn:"plain"},play:async({canvasElement:e})=>{const t=c(e);if(!t)throw new Error("the plain surface is not mounted");await n.click(t),await n.keyboard(U),await x(async()=>{await a(i(e)).toHaveTextContent("NL")},{timeout:5e3}),await n.click(i(e)),await n.click(s(e).getByRole("menuitemradio",{name:/English/})),await a(i(e)).toHaveTextContent("EN"),await n.click(t),await n.keyboard(" Groetjes, Matthijs."),await new Promise(r=>setTimeout(r,800)),await a(i(e)).toHaveTextContent("EN"),await a(t).toHaveAttribute("lang","en")}},v={name:"Shift+Tab twice reaches the chip",args:{initialHtml:"<p>Hoi.</p>"},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await n.click(t),await n.tab({shift:!0}),await a(o(e)).toHaveFocus(),await n.tab({shift:!0}),await a(i(e)).toHaveFocus(),await n.keyboard("{Enter}"),await x(async()=>{await a(e.querySelector("[data-testid=compose-language-menu]")).not.toBeNull()}),await n.keyboard("{ArrowDown}{Enter}"),await a(i(e)).toHaveTextContent("EN"),await a(i(e)).toHaveFocus(),await a(t).toHaveAttribute("lang","en")}},f={name:"Plain text keeps the same language",args:{initialHtml:N},play:async({canvasElement:e})=>{await x(async()=>{await a(i(e)).toHaveTextContent("NL")},{timeout:5e3}),await n.click(o(e));const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t).toHaveAttribute("lang","nl"),await a(i(e)).toHaveTextContent("NL")}},b={name:"A French quote under a Dutch reply",args:{initialHtml:N,quoted:"Bonjour, je vous confirme que la réunion de jeudi est annulée. Je vous propose de la reporter à la semaine prochaine."},play:async({canvasElement:e})=>{await x(async()=>{await a(i(e)).toHaveTextContent("NL")},{timeout:5e3}),await a(e.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang","nl")}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  name: "Rich, with formatting",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...E.parameters?.docs?.source}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "Plain, reopened from Markdown",
  args: {
    startIn: "plain",
    initialText: PLAIN_MARKDOWN
  }
}`,...k.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "The warning, cancelled",
  args: {
    initialHtml: RICH_DOCUMENT
  },
  play: async ({
    canvasElement
  }) => {
    const toggle = toggleOf(canvasElement);
    await userEvent.click(toggle);
    const dialog = within(document.body).getByRole("dialog");
    await expect(dialog).toHaveTextContent("Switch to plain text?");
    await expect(dialog).toHaveTextContent("Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it.");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(dialog).getByRole("button", {
      name: "Cancel"
    }));
    await expect(plainSurface(canvasElement)).toBeNull();
    await expect(canvasElement.querySelector("[data-testid=compose-body] table")).not.toBeNull();
    await expect(toggleOf(canvasElement)).toHaveFocus();
  }
}`,...l.parameters?.docs?.source},description:{story:"Cancel changes nothing: the mode stays rich, the document is untouched, and\nfocus comes back to the control that was pressed. `aria-pressed` never flips\noptimistically.",...l.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "The warning, confirmed",
  args: {
    initialHtml: RICH_DOCUMENT
  },
  play: async ({
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    await userEvent.click(within(within(document.body).getByRole("dialog")).getByRole("button", {
      name: "Switch to plain text"
    }));
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface did not arrive");
    await expect(textarea.value).toContain("## Quarterly numbers");
    await expect(textarea.value).toContain("**up**");
    await expect(textarea.value).toContain("| EMEA | 412 |");

    // The formatting buttons leave with the rich surface.
    await expect(canvasElement.querySelector("[aria-label='Bold (Ctrl+B)']")).toBeNull();
    await expect(toggleOf(canvasElement)).toHaveAttribute("aria-pressed", "true");
    await expect(textarea).toHaveFocus();
    await expect(textarea.selectionStart).toBe(textarea.value.length);
  }
}`,...T.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Plain paragraphs switch without asking",
  args: {
    initialHtml: PLAIN_PARAGRAPHS
  },
  play: async ({
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    await expect(within(document.body).queryByRole("dialog")).toBeNull();
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface did not arrive");
    await expect(textarea.value).toContain("Thanks");
    await expect(textarea.value).toContain("See you then.");
  }
}`,...d.parameters?.docs?.source},description:{story:"Nothing but paragraphs and a blank line: switching changes nothing, so nothing is asked.",...d.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "An underline alone still warns",
  args: {
    initialHtml: UNDERLINED
  },
  play: async ({
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    await expect(within(document.body).getByRole("dialog")).toHaveTextContent("Switch to plain text?");
  }
}`,...u.parameters?.docs?.source},description:{story:`An underlined word exports identical to its own characters, so a comparison
of the two strings would switch in silence and destroy it. The rule reads the
document instead.`,...u.parameters?.docs?.description}}};H.parameters={...H.parameters,docs:{...H.parameters?.docs,source:{originalSource:`{
  name: "Markdown back to rich, without asking",
  args: {
    startIn: "plain",
    initialText: PLAIN_MARKDOWN
  },
  play: async ({
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    await expect(within(document.body).queryByRole("dialog")).toBeNull();
    const editable = canvasElement.querySelector("[data-testid=compose-body]");
    if (!editable) throw new Error("the rich surface did not arrive");
    await expect(editable.querySelector("h2")).not.toBeNull();
    await expect(editable.querySelector("table td")).not.toBeNull();
  }
}`,...H.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Prose with no Markdown in it",
  args: {
    startIn: "plain",
    initialText: "Thanks — that works.\\n\\nI'll send the deck tomorrow."
  },
  play: async ({
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    const editable = canvasElement.querySelector("[data-testid=compose-body]");
    if (!editable) throw new Error("the rich surface did not arrive");
    await expect(editable.querySelectorAll("p").length).toBe(2);
    await expect(editable.textContent).toContain("Thanks — that works.");
    await expect(editable.textContent).toContain("I'll send the deck tomorrow.");
  }
}`,...p.parameters?.docs?.source},description:{story:"Switching an ordinary note to rich must not reflow it.",...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "A conversion that came back empty",
  args: {
    startIn: "plain",
    initialText: "Everything I wrote this morning.",
    onConversionError: fn(),
    conversions: {
      toPlain: value => value.text,
      toRich: () => ""
    }
  },
  play: async ({
    args,
    canvasElement
  }) => {
    await userEvent.click(toggleOf(canvasElement));
    await expect(args.onConversionError).toHaveBeenCalledWith({
      outcome: "blocked",
      title: "Couldn't switch to rich text",
      detail: "The conversion came back empty, so your message is unchanged."
    });
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface left");
    await expect(textarea.value).toBe("Everything I wrote this morning.");
    await expect(toggleOf(canvasElement)).toHaveAttribute("aria-pressed", "true");
  }
}`,...m.parameters?.docs?.source},description:{story:`A conversion that would blank a written message does not happen: autosave
would persist the empty body a moment later and the draft would be gone with
nothing said.`,...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "Shift+Tab from the body reaches it",
  args: {
    initialHtml: PLAIN_PARAGRAPHS
  },
  play: async ({
    canvasElement
  }) => {
    const editable = canvasElement.querySelector<HTMLElement>("[data-testid=compose-body]");
    if (!editable) throw new Error("the rich surface is not mounted");
    await userEvent.click(editable);
    await userEvent.tab({
      shift: true
    });
    await expect(toggleOf(canvasElement)).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(plainSurface(canvasElement)).not.toBeNull();
  }
}`,...h.parameters?.docs?.source},description:{story:"One Shift+Tab out of the body reaches the toggle, and Enter acts.",...h.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  name: "Dutch prose sets the chip",
  args: {
    initialHtml: DUTCH_DOCUMENT
  },
  play: async ({
    canvasElement
  }) => {
    await waitFor(async () => {
      await expect(chipOf(canvasElement)).toHaveTextContent("NL");
    }, {
      timeout: 5000
    });
    await expect(canvasElement.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang", "nl");
  }
}`,...w.parameters?.docs?.source},description:{story:`Detection runs over the body against the account's own languages and writes
the result onto the writing surface. Firefox picks a dictionary from that tag
among the ones the user installed; Chrome and Safari ignore it, and nothing
here says otherwise.`,...w.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  name: "Nine characters hold the default",
  args: {
    startIn: "plain"
  },
  play: async ({
    canvasElement
  }) => {
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface is not mounted");
    await userEvent.click(textarea);
    await userEvent.keyboard("Hi Sophie");
    await new Promise(resolve => setTimeout(resolve, 800));
    await expect(chipOf(canvasElement)).toHaveTextContent("NL");
  }
}`,...g.parameters?.docs?.source},description:{story:"Under twenty characters detection is a coin toss, so the account default stands.",...g.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  name: "A picked language survives more typing",
  args: {
    startIn: "plain"
  },
  play: async ({
    canvasElement
  }) => {
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface is not mounted");
    await userEvent.click(textarea);
    await userEvent.keyboard(DUTCH_PROSE);
    await waitFor(async () => {
      await expect(chipOf(canvasElement)).toHaveTextContent("NL");
    }, {
      timeout: 5000
    });
    await userEvent.click(chipOf(canvasElement));
    await userEvent.click(within(canvasElement).getByRole("menuitemradio", {
      name: /English/
    }));
    await expect(chipOf(canvasElement)).toHaveTextContent("EN");
    await userEvent.click(textarea);
    await userEvent.keyboard(" Groetjes, Matthijs.");
    await new Promise(resolve => setTimeout(resolve, 800));
    await expect(chipOf(canvasElement)).toHaveTextContent("EN");
    await expect(textarea).toHaveAttribute("lang", "en");
  }
}`,...y.parameters?.docs?.source},description:{story:`The first manual pick freezes the language for the rest of the message.
Detection does not argue with a choice the user made — a tag that moved back
under the caret would be a control that undoes itself.`,...y.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  name: "Shift+Tab twice reaches the chip",
  // Short enough that detection declines, so the chip is on the account
  // default and the arrow key below has a known row to move off.
  args: {
    initialHtml: "<p>Hoi.</p>"
  },
  play: async ({
    canvasElement
  }) => {
    const editable = canvasElement.querySelector<HTMLElement>("[data-testid=compose-body]");
    if (!editable) throw new Error("the rich surface is not mounted");
    await userEvent.click(editable);
    await userEvent.tab({
      shift: true
    });
    await expect(toggleOf(canvasElement)).toHaveFocus();
    await userEvent.tab({
      shift: true
    });
    await expect(chipOf(canvasElement)).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(async () => {
      await expect(canvasElement.querySelector("[data-testid=compose-language-menu]")).not.toBeNull();
    });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(chipOf(canvasElement)).toHaveTextContent("EN");
    await expect(chipOf(canvasElement)).toHaveFocus();
    await expect(editable).toHaveAttribute("lang", "en");
  }
}`,...v.parameters?.docs?.source},description:{story:`Two Shift+Tabs out of the body reach the chip — one still reaches the mode
toggle, where #673 put it. The menu takes focus as it opens and hands it back
to the chip on a pick, so the keyboard never lands somewhere it cannot leave.`,...v.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  name: "Plain text keeps the same language",
  args: {
    initialHtml: DUTCH_DOCUMENT
  },
  play: async ({
    canvasElement
  }) => {
    await waitFor(async () => {
      await expect(chipOf(canvasElement)).toHaveTextContent("NL");
    }, {
      timeout: 5000
    });
    await userEvent.click(toggleOf(canvasElement));
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface did not arrive");
    await expect(textarea).toHaveAttribute("lang", "nl");
    await expect(chipOf(canvasElement)).toHaveTextContent("NL");
  }
}`,...f.parameters?.docs?.source},description:{story:"The tag follows the message across the mode switch, onto whichever surface is up.",...f.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  name: "A French quote under a Dutch reply",
  args: {
    initialHtml: DUTCH_DOCUMENT,
    quoted: "Bonjour, je vous confirme que la réunion de jeudi est annulée. Je vous propose de la reporter à la semaine prochaine."
  },
  play: async ({
    canvasElement
  }) => {
    await waitFor(async () => {
      await expect(chipOf(canvasElement)).toHaveTextContent("NL");
    }, {
      timeout: 5000
    });
    await expect(canvasElement.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang", "nl");
  }
}`,...b.parameters?.docs?.source},description:{story:`The quoted block a reply is written above is somebody else's text. It lives
outside the editor, so detection never sees it and a French thread answered
in Dutch is tagged Dutch.`,...b.parameters?.docs?.description}}};const pe=["RichDocument","PlainDraft","WarningCancelled","WarningConfirmed","PlainProseSwitchesSilently","UnderlineStillWarns","PlainToRich","PlainProseToRich","ConversionCameBackEmpty","ReachableFromTheBody","DutchIsDetected","TooShortHoldsTheDefault","ManualPickSticks","ChipFromTheKeyboard","PlainSurfaceCarriesTheLanguage","QuotedTextIsNotRead"];export{v as ChipFromTheKeyboard,m as ConversionCameBackEmpty,w as DutchIsDetected,y as ManualPickSticks,k as PlainDraft,d as PlainProseSwitchesSilently,p as PlainProseToRich,f as PlainSurfaceCarriesTheLanguage,H as PlainToRich,b as QuotedTextIsNotRead,h as ReachableFromTheBody,E as RichDocument,g as TooShortHoldsTheDefault,u as UnderlineStillWarns,l as WarningCancelled,T as WarningConfirmed,pe as __namedExportsOrder,ue as default};
