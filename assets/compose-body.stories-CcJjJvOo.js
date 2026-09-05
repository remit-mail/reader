import{r as I,j as d}from"./iframe-uufGNBEn.js";import{d as z}from"./compose-language-B4uv5zOH.js";import{C as J}from"./compose-body-CuD0G-vW.js";import"./preload-helper-PPVm8Dsz.js";import"./compose-language-chip-BaoA3R-t.js";import"./cn-d2XQ1MEC.js";import"./roving-focus-C30yPp50.js";import"./button-Wi0n0Lyz.js";import"./compose-mode-toggle-cB6vyUO0.js";import"./confirm-dialog-enH6NvMA.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./dialog-backdrop-Cp-aOj13.js";import"./plain-text-editor-BBKfqjiN.js";import"./banner-D7bQEtJc.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./rich-text-document-Dd4zTfcc.js";import"./purify.es-P3vI1IgJ.js";import"./rich-text-editor-CyzL4GEj.js";import"./index-kPMH9ZlQ.js";import"./index-8Sr_-kjb.js";import"./use-match-media-ZIkBguB9.js";import"./bottom-sheet-BCAOj2Xc.js";import"./use-initial-focus-BI_G8RKS.js";import"./popover-menu-B7ne2TDp.js";import"./eye-off-DG3viZAf.js";import"./attachment-file-qTo3Y5Tj.js";import"./circle-alert-Dg_Tz5Bw.js";import"./loader-circle-qkSTSuP1.js";import"./undo-2-IlFQFy-A.js";const{expect:a,fn:Y,userEvent:n,waitFor:l,within:s}=__STORYBOOK_MODULE_TEST__,R=["<h2>Quarterly numbers</h2>","<p>Revenue is <strong>up</strong> on the quarter.</p>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>"].join(""),M="<p>Thanks — that works.</p><p></p><p>See you then.</p>",V="<p>Please <u>read this</u> before Friday.</p>",L=["## Quarterly numbers","","| Region | Total |","| --- | --- |","| EMEA | 412 |"].join(`
`),B="<p>Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel voor de planning.</p>",X="Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel.",Z=["nl","en","de"],$="<p></p><p>-- </p><p>Matthijs</p>",ee=["Beste Anna, hierbij de planning voor volgende week zoals besproken tijdens de vergadering van donderdag.","","| Region | Total |","| --- | --- |","| EMEA | 412 |"].join(`
`),q=()=>{},te=({initialHtml:e="",initialText:t="",startIn:o="rich",initialCaret:F,onConversionError:_,conversions:U,languages:j=Z,quoted:P,width:W=680})=>{const[G,K]=I.useState(o),[O,Q]=I.useState();return d.jsxs("div",{style:{width:W},className:"flex h-[460px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:[O&&d.jsxs("div",{role:"alert","data-testid":"compose-conversion-error",className:"border-b border-danger/30 bg-danger-soft px-3 py-2 text-xs",children:[d.jsx("p",{className:"font-medium text-danger",children:O.title}),d.jsx("p",{className:"text-fg-muted",children:O.detail})]}),d.jsx(J,{mode:G,onModeChange:K,initialHtml:e,initialText:t,initialCaret:F,onChange:q,onConversionError:D=>{Q(D),_?.(D)},conversions:U,languages:j,onLanguageChange:q}),P&&d.jsx("blockquote",{"data-testid":"compose-quoted",lang:"fr",className:"border-l-2 border-line px-3 py-2 text-sm text-fg-muted",children:P})]})},r=e=>{const t=e.querySelector("[data-testid=compose-language-chip]");if(!t)throw new Error("the language chip is not mounted");return t},Pe={title:"Mail/ComposeBody",component:te,parameters:{layout:"centered",docs:{description:{component:"The mode switch as the compose window runs it: the toolbar control, the one\nwarning it raises, and the two surfaces it swaps between. The live\n`ComposeForm` adds the recipients, the autosave and the send around this."}}}},i=e=>{const t=e.querySelector("[data-testid=compose-mode-toggle]");if(!t)throw new Error("the mode toggle is not mounted");return t},c=e=>e.querySelector("[data-testid=compose-body-plain]"),S={name:"Rich, with formatting",args:{initialHtml:R}},p={name:"A new message opens above the signature",args:{initialHtml:$,initialCaret:"start"},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await l(async()=>{await a(t).toHaveFocus()}),await n.keyboard("Hoi Anna"),await l(async()=>{const o=t.textContent??"";await a(o).toContain("Hoi Anna"),await a(o.indexOf("Hoi Anna")).toBeLessThan(o.indexOf("Matthijs"))})}},u={name:"Plain, wrapping at a phone's width",args:{startIn:"plain",initialText:ee,width:390},play:async({canvasElement:e})=>{const t=c(e);if(!t)throw new Error("the plain surface is not mounted");await a(t.scrollWidth).toBeLessThanOrEqual(t.clientWidth+1)}},C={name:"Plain, reopened from Markdown",args:{startIn:"plain",initialText:L}},h={name:"The warning, cancelled",args:{initialHtml:R},play:async({canvasElement:e})=>{const t=i(e);await n.click(t);const o=s(document.body).getByRole("dialog");await a(o).toHaveTextContent("Switch to plain text?"),await a(o).toHaveTextContent("Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it."),await a(t).toHaveAttribute("aria-pressed","false"),await n.click(s(o).getByRole("button",{name:"Cancel"})),await a(c(e)).toBeNull(),await a(e.querySelector("[data-testid=compose-body] table")).not.toBeNull(),await a(i(e)).toHaveFocus()}},N={name:"The warning, confirmed",args:{initialHtml:R},play:async({canvasElement:e})=>{await n.click(i(e)),await n.click(s(s(document.body).getByRole("dialog")).getByRole("button",{name:"Switch to plain text"}));const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("## Quarterly numbers"),await a(t.value).toContain("**up**"),await a(t.value).toContain("| EMEA | 412 |"),await a(e.querySelector("[aria-label='Bold (Ctrl+B)']")).toBeNull(),await a(i(e)).toHaveAttribute("aria-pressed","true"),await a(t).toHaveFocus(),await a(t.selectionStart).toBe(t.value.length)}},m={name:"Plain paragraphs switch without asking",args:{initialHtml:M},play:async({canvasElement:e})=>{await n.click(i(e)),await a(s(document.body).queryByRole("dialog")).toBeNull();const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("Thanks"),await a(t.value).toContain("See you then.")}},w={name:"An underline alone still warns",args:{initialHtml:V},play:async({canvasElement:e})=>{await n.click(i(e)),await a(s(document.body).getByRole("dialog")).toHaveTextContent("Switch to plain text?")}},A={name:"Markdown back to rich, without asking",args:{startIn:"plain",initialText:L},play:async({canvasElement:e})=>{await n.click(i(e)),await a(s(document.body).queryByRole("dialog")).toBeNull();const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelector("h2")).not.toBeNull(),await a(t.querySelector("table td")).not.toBeNull()}},g={name:"Prose with no Markdown in it",args:{startIn:"plain",initialText:`Thanks — that works.

I'll send the deck tomorrow.`},play:async({canvasElement:e})=>{await n.click(i(e));const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelectorAll("p").length).toBe(2),await a(t.textContent).toContain("Thanks — that works."),await a(t.textContent).toContain("I'll send the deck tomorrow.")}},y={name:"A conversion that came back empty",args:{startIn:"plain",initialText:"Everything I wrote this morning.",onConversionError:Y(),conversions:{toPlain:e=>e.text,toRich:()=>""}},play:async({args:e,canvasElement:t})=>{await n.click(i(t)),await a(e.onConversionError).toHaveBeenCalledWith({outcome:"blocked",title:"Couldn't switch to rich text",detail:"The conversion came back empty, so your message is unchanged."}),await a(s(t).getByTestId("compose-conversion-error")).toHaveTextContent("Couldn't switch to rich text");const o=c(t);if(!o)throw new Error("the plain surface left");await a(o.value).toBe("Everything I wrote this morning."),await a(i(t)).toHaveAttribute("aria-pressed","true")}},v={name:"Shift+Tab from the body reaches it",args:{initialHtml:M},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await n.click(t),await n.tab({shift:!0}),await a(i(e)).toHaveFocus(),await n.keyboard("{Enter}"),await a(c(e)).not.toBeNull()}},f={name:"Dutch prose sets the chip",args:{initialHtml:B},play:async({canvasElement:e})=>{await l(async()=>{await a(r(e)).toHaveTextContent("NL")},{timeout:5e3}),await a(e.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang","nl")}},x={name:"Dutch on an English browser, nothing configured",args:{initialHtml:B,languages:z(["en-US","en"],["en","en-GB","nl"])},play:async({canvasElement:e})=>{await l(async()=>{await a(r(e)).toHaveTextContent("NL")},{timeout:5e3}),await a(e.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang","nl")}},b={name:"Nine characters hold the default",args:{startIn:"plain"},play:async({canvasElement:e})=>{const t=c(e);if(!t)throw new Error("the plain surface is not mounted");await n.click(t),await n.keyboard("Hi Sophie"),await new Promise(o=>setTimeout(o,800)),await a(r(e)).toHaveTextContent("NL")}},E={name:"A picked language survives more typing",args:{startIn:"plain"},play:async({canvasElement:e})=>{const t=c(e);if(!t)throw new Error("the plain surface is not mounted");await n.click(t),await n.keyboard(X),await l(async()=>{await a(r(e)).toHaveTextContent("NL")},{timeout:5e3}),await n.click(r(e)),await n.click(s(e).getByRole("menuitemradio",{name:/English/})),await a(r(e)).toHaveTextContent("EN"),await n.click(t),await n.keyboard(" Groetjes, Matthijs."),await new Promise(o=>setTimeout(o,800)),await a(r(e)).toHaveTextContent("EN"),await a(t).toHaveAttribute("lang","en")}},T={name:"Shift+Tab twice reaches the chip",args:{initialHtml:"<p>Hoi.</p>"},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await n.click(t),await n.tab({shift:!0}),await a(i(e)).toHaveFocus(),await n.tab({shift:!0}),await a(r(e)).toHaveFocus(),await n.keyboard("{Enter}"),await l(async()=>{await a(e.querySelector("[data-testid=compose-language-menu]")).not.toBeNull()}),await n.keyboard("{ArrowDown}{Enter}"),await a(r(e)).toHaveTextContent("EN"),await a(r(e)).toHaveFocus(),await a(t).toHaveAttribute("lang","en")}},k={name:"Plain text keeps the same language",args:{initialHtml:B},play:async({canvasElement:e})=>{await l(async()=>{await a(r(e)).toHaveTextContent("NL")},{timeout:5e3}),await n.click(i(e));const t=c(e);if(!t)throw new Error("the plain surface did not arrive");await a(t).toHaveAttribute("lang","nl"),await a(r(e)).toHaveTextContent("NL")}},H={name:"A French quote under a Dutch reply",args:{initialHtml:B,quoted:"Bonjour, je vous confirme que la réunion de jeudi est annulée. Je vous propose de la reporter à la semaine prochaine."},play:async({canvasElement:e})=>{await l(async()=>{await a(r(e)).toHaveTextContent("NL")},{timeout:5e3}),await a(e.querySelector("[data-testid=compose-body]")).toHaveAttribute("lang","nl")}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  name: "Rich, with formatting",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...S.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "A new message opens above the signature",
  args: {
    initialHtml: SIGNED_DOCUMENT,
    initialCaret: "start"
  },
  play: async ({
    canvasElement
  }) => {
    const editable = canvasElement.querySelector<HTMLElement>("[data-testid=compose-body]");
    if (!editable) throw new Error("the rich surface is not mounted");
    await waitFor(async () => {
      await expect(editable).toHaveFocus();
    });
    await userEvent.keyboard("Hoi Anna");
    await waitFor(async () => {
      const text = editable.textContent ?? "";
      await expect(text).toContain("Hoi Anna");
      await expect(text.indexOf("Hoi Anna")).toBeLessThan(text.indexOf("Matthijs"));
    });
  }
}`,...p.parameters?.docs?.source},description:{story:`A new message opens above its signature. The caret used to land at the end of
the document, which on any account that has one put the first keystroke under
the sign-off.`,...p.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "Plain, wrapping at a phone's width",
  args: {
    startIn: "plain",
    initialText: LONG_PLAIN_PROSE,
    width: 390
  },
  play: async ({
    canvasElement
  }) => {
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface is not mounted");
    // A pixel of tolerance: sub-pixel layout rounding, not a scrollbar.
    await expect(textarea.scrollWidth).toBeLessThanOrEqual(textarea.clientWidth + 1);
  }
}`,...u.parameters?.docs?.source},description:{story:`Plain prose wraps. A message whose every paragraph ran off the right edge
could not be read back at all, which is the worse of the two failures at 390 —
a pipe table wider than the surface is the one that gives.`,...u.parameters?.docs?.description}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Plain, reopened from Markdown",
  args: {
    startIn: "plain",
    initialText: PLAIN_MARKDOWN
  }
}`,...C.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
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
}`,...h.parameters?.docs?.source},description:{story:"Cancel changes nothing: the mode stays rich, the document is untouched, and\nfocus comes back to the control that was pressed. `aria-pressed` never flips\noptimistically.",...h.parameters?.docs?.description}}};N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
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
}`,...N.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source},description:{story:"Nothing but paragraphs and a blank line: switching changes nothing, so nothing is asked.",...m.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
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
}`,...w.parameters?.docs?.source},description:{story:`An underlined word exports identical to its own characters, so a comparison
of the two strings would switch in silence and destroy it. The rule reads the
document instead.`,...w.parameters?.docs?.description}}};A.parameters={...A.parameters,docs:{...A.parameters?.docs,source:{originalSource:`{
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
}`,...A.parameters?.docs?.source}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
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
}`,...g.parameters?.docs?.source},description:{story:"Switching an ordinary note to rich must not reflow it.",...g.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
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
    await expect(within(canvasElement).getByTestId("compose-conversion-error")).toHaveTextContent("Couldn't switch to rich text");
    const textarea = plainSurface(canvasElement);
    if (!textarea) throw new Error("the plain surface left");
    await expect(textarea.value).toBe("Everything I wrote this morning.");
    await expect(toggleOf(canvasElement)).toHaveAttribute("aria-pressed", "true");
  }
}`,...y.parameters?.docs?.source},description:{story:`A conversion that would blank a written message does not happen: autosave
would persist the empty body a moment later and the draft would be gone with
nothing said.`,...y.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
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
}`,...v.parameters?.docs?.source},description:{story:"One Shift+Tab out of the body reaches the toggle, and Enter acts.",...v.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
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
}`,...f.parameters?.docs?.source},description:{story:`Detection runs over the body against the account's own languages and writes
the result onto the writing surface. Firefox picks a dictionary from that tag
among the ones the user installed; Chrome and Safari ignore it, and nothing
here says otherwise.`,...f.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  name: "Dutch on an English browser, nothing configured",
  args: {
    initialHtml: DUTCH_DOCUMENT,
    languages: defaultComposeLanguages(["en-US", "en"], ["en", "en-GB", "nl"])
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
}`,...x.parameters?.docs?.source},description:{story:`The account that has never opened the language setting, read on an English
browser. Its candidate set is the browser's answer and the dictionaries this
build carries — a set of one would be detection switched off, and a Dutch
message would keep the English tag and the English underlines.`,...x.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
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
}`,...b.parameters?.docs?.source},description:{story:"Under twenty characters detection is a coin toss, so the account default stands.",...b.parameters?.docs?.description}}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
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
}`,...E.parameters?.docs?.source},description:{story:`The first manual pick freezes the language for the rest of the message.
Detection does not argue with a choice the user made — a tag that moved back
under the caret would be a control that undoes itself.`,...E.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
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
}`,...T.parameters?.docs?.source},description:{story:`Two Shift+Tabs out of the body reach the chip — one still reaches the mode
toggle, where #673 put it. The menu takes focus as it opens and hands it back
to the chip on a pick, so the keyboard never lands somewhere it cannot leave.`,...T.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
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
}`,...k.parameters?.docs?.source},description:{story:"The tag follows the message across the mode switch, onto whichever surface is up.",...k.parameters?.docs?.description}}};H.parameters={...H.parameters,docs:{...H.parameters?.docs,source:{originalSource:`{
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
}`,...H.parameters?.docs?.source},description:{story:`The quoted block a reply is written above is somebody else's text. It lives
outside the editor, so detection never sees it and a French thread answered
in Dutch is tagged Dutch.`,...H.parameters?.docs?.description}}};const De=["RichDocument","OpensAboveTheSignature","PlainProseWraps","PlainDraft","WarningCancelled","WarningConfirmed","PlainProseSwitchesSilently","UnderlineStillWarns","PlainToRich","PlainProseToRich","ConversionCameBackEmpty","ReachableFromTheBody","DutchIsDetected","UnconfiguredAccountStillReadsDutch","TooShortHoldsTheDefault","ManualPickSticks","ChipFromTheKeyboard","PlainSurfaceCarriesTheLanguage","QuotedTextIsNotRead"];export{T as ChipFromTheKeyboard,y as ConversionCameBackEmpty,f as DutchIsDetected,E as ManualPickSticks,p as OpensAboveTheSignature,C as PlainDraft,m as PlainProseSwitchesSilently,g as PlainProseToRich,u as PlainProseWraps,k as PlainSurfaceCarriesTheLanguage,A as PlainToRich,H as QuotedTextIsNotRead,v as ReachableFromTheBody,S as RichDocument,b as TooShortHoldsTheDefault,x as UnconfiguredAccountStillReadsDutch,w as UnderlineStillWarns,h as WarningCancelled,N as WarningConfirmed,De as __namedExportsOrder,Pe as default};
