import{r as c,j as s}from"./iframe-uTafckjr.js";import{C as $,aj as ee}from"./rich-text-document-BuK3ZpQ5.js";import{P as te}from"./plain-text-editor-BT7WFsHz.js";import{R as ae}from"./rich-text-editor-CtQLlNf_.js";import{C as ne}from"./ConfirmDialog-CsMqqNSl.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./button-DCXIHjmE.js";import"./purify.es-2FREwzWT.js";import"./banner-Hh0xdm4p.js";import"./x-DS_pud-s.js";import"./createLucideIcon-DLYy-DY-.js";import"./index-DI-IM0Ba.js";import"./index-DN3_ZXiR.js";import"./undo-2-BTY7r3H6.js";import"./utils-BLNPqUX_.js";const oe=(e,t)=>t.length>0,re={plain:"Couldn't switch to plain text",rich:"Couldn't switch to rich text"},F=(e,t,n)=>t.trim()===""||n.trim()!==""?{outcome:"switch"}:{outcome:"blocked",title:re[e],detail:"The conversion came back empty, so your message is unchanged."},ie={toPlain:e=>e.text,toRich:e=>ee(e)},D=e=>new DOMParser().parseFromString(e,"text/html").body.textContent??"",W=e=>({html:"",text:e,formatting:[]}),L=({mode:e,onModeChange:t,initialHtml:n,initialText:v,onChange:u,onSubmit:x,autoFocus:T=!1,onConversionError:N,conversions:A=ie})=>{const[V,G]=c.useState(n),[K,Q]=c.useState(0),[R,O]=c.useState(v),[Y,B]=c.useState(!1),[q,I]=c.useState(!1),H=c.useRef({html:n,text:v,formatting:[]}),z=r=>{H.current=r,u(r)},J=r=>{O(r),u(W(r))},M=()=>{const r=H.current,d=A.toPlain(r),b=F("plain",D(r.html),d);if(b.outcome==="blocked"){N(b);return}O(d),I(!0),u(W(d)),t("plain")},X=()=>{const r=A.toRich(R),d=F("rich",R,D(r));if(d.outcome==="blocked"){N(d);return}G(r),Q(b=>b+1),I(!0),t("rich")},Z=()=>{if(e==="plain"){X();return}if(oe("plain",H.current.formatting)){B(!0);return}M()},_=s.jsx($,{mode:e,onToggle:Z});return s.jsxs(s.Fragment,{children:[e==="plain"?s.jsx(te,{value:R,onChange:J,onSubmit:x,autoFocus:q,trailing:_}):s.jsx(ae,{initialHtml:V,onChange:z,onSubmit:x,autoFocus:T||q,trailing:_},K),s.jsx(ne,{isOpen:Y,title:"Switch to plain text?",description:"Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it.",confirmLabel:"Switch to plain text",onConfirm:()=>{B(!1),M()},onCancel:()=>B(!1)})]})};L.__docgenInfo={description:`The compose writing surface and the control that swaps it. Rich text is the
WYSIWYG document; plain text is a textarea whose content is the Markdown that
will be sent verbatim. The conversion runs over an in-memory document, so the
surface swaps in the same frame the choice is made.`,methods:[],displayName:"ComposeBody",props:{mode:{required:!0,tsType:{name:"ComposeBodyMode"},description:""},onModeChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(mode: ComposeBodyMode) => void",signature:{arguments:[{type:{name:"ComposeBodyMode"},name:"mode"}],return:{name:"void"}}},description:""},initialHtml:{required:!0,tsType:{name:"string"},description:""},initialText:{required:!0,tsType:{name:"string"},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(value: RichTextValue) => void",signature:{arguments:[{type:{name:"RichTextValue"},name:"value"}],return:{name:"void"}}},description:""},onSubmit:{required:!1,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},autoFocus:{required:!1,tsType:{name:"boolean"},description:"",defaultValue:{value:"false",computed:!1}},onConversionError:{required:!0,tsType:{name:"signature",type:"function",raw:"(failure: ConversionFailure) => void",signature:{arguments:[{type:{name:"ConversionFailure"},name:"failure"}],return:{name:"void"}}},description:""},conversions:{required:!1,tsType:{name:"ComposeConversions"},description:"",defaultValue:{value:`{
	toPlain: (value) => value.text,
	toRich: (text) => markdownToHtml(text),
}`,computed:!1}}}};const{expect:a,fn:se,userEvent:o,within:l}=__STORYBOOK_MODULE_TEST__,P=["<h2>Quarterly numbers</h2>","<p>Revenue is <strong>up</strong> on the quarter.</p>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>"].join(""),j="<p>Thanks — that works.</p><p></p><p>See you then.</p>",ce="<p>Please <u>read this</u> before Friday.</p>",U=["## Quarterly numbers","","| Region | Total |","| --- | --- |","| EMEA | 412 |"].join(`
`),le=({initialHtml:e="",initialText:t="",startIn:n="rich",onConversionError:v=()=>{},conversions:u})=>{const[x,T]=c.useState(n);return s.jsx("div",{className:"flex h-[460px] w-[680px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:s.jsx(L,{mode:x,onModeChange:T,initialHtml:e,initialText:t,onChange:()=>{},onConversionError:v,conversions:u})})},Re={title:"Screens/WebClient/ComposeModes",component:le,parameters:{layout:"centered",docs:{description:{component:"The mode switch as the compose window runs it: the toolbar control, the one\nwarning it raises, and the two surfaces it swaps between. The live\n`ComposeForm` adds the recipients, the autosave and the send around this."}}}},i=e=>{const t=e.querySelector("[data-testid=compose-mode-toggle]");if(!t)throw new Error("the mode toggle is not mounted");return t},f=e=>e.querySelector("[data-testid=compose-body-plain]"),E={name:"Rich, with formatting",args:{initialHtml:P}},C={name:"Plain, reopened from Markdown",args:{startIn:"plain",initialText:U}},m={name:"The warning, cancelled",args:{initialHtml:P},play:async({canvasElement:e})=>{const t=i(e);await o.click(t);const n=l(document.body).getByRole("dialog");await a(n).toHaveTextContent("Switch to plain text?"),await a(n).toHaveTextContent("Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it."),await a(t).toHaveAttribute("aria-pressed","false"),await o.click(l(n).getByRole("button",{name:"Cancel"})),await a(f(e)).toBeNull(),await a(e.querySelector("[data-testid=compose-body] table")).not.toBeNull(),await a(i(e)).toHaveFocus()}},S={name:"The warning, confirmed",args:{initialHtml:P},play:async({canvasElement:e})=>{await o.click(i(e)),await o.click(l(l(document.body).getByRole("dialog")).getByRole("button",{name:"Switch to plain text"}));const t=f(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("## Quarterly numbers"),await a(t.value).toContain("**up**"),await a(t.value).toContain("| EMEA | 412 |"),await a(e.querySelector("[aria-label='Bold (Ctrl+B)']")).toBeNull(),await a(i(e)).toHaveAttribute("aria-pressed","true"),await a(t).toHaveFocus(),await a(t.selectionStart).toBe(t.value.length)}},p={name:"Plain paragraphs switch without asking",args:{initialHtml:j},play:async({canvasElement:e})=>{await o.click(i(e)),await a(l(document.body).queryByRole("dialog")).toBeNull();const t=f(e);if(!t)throw new Error("the plain surface did not arrive");await a(t.value).toContain("Thanks"),await a(t.value).toContain("See you then.")}},h={name:"An underline alone still warns",args:{initialHtml:ce},play:async({canvasElement:e})=>{await o.click(i(e)),await a(l(document.body).getByRole("dialog")).toHaveTextContent("Switch to plain text?")}},k={name:"Markdown back to rich, without asking",args:{startIn:"plain",initialText:U},play:async({canvasElement:e})=>{await o.click(i(e)),await a(l(document.body).queryByRole("dialog")).toBeNull();const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelector("h2")).not.toBeNull(),await a(t.querySelector("table td")).not.toBeNull()}},w={name:"Prose with no Markdown in it",args:{startIn:"plain",initialText:`Thanks — that works.

I'll send the deck tomorrow.`},play:async({canvasElement:e})=>{await o.click(i(e));const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface did not arrive");await a(t.querySelectorAll("p").length).toBe(2),await a(t.textContent).toContain("Thanks — that works."),await a(t.textContent).toContain("I'll send the deck tomorrow.")}},g={name:"A conversion that came back empty",args:{startIn:"plain",initialText:"Everything I wrote this morning.",onConversionError:se(),conversions:{toPlain:e=>e.text,toRich:()=>""}},play:async({args:e,canvasElement:t})=>{await o.click(i(t)),await a(e.onConversionError).toHaveBeenCalledWith({outcome:"blocked",title:"Couldn't switch to rich text",detail:"The conversion came back empty, so your message is unchanged."});const n=f(t);if(!n)throw new Error("the plain surface left");await a(n.value).toBe("Everything I wrote this morning."),await a(i(t)).toHaveAttribute("aria-pressed","true")}},y={name:"Shift+Tab from the body reaches it",args:{initialHtml:j},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the rich surface is not mounted");await o.click(t),await o.tab({shift:!0}),await a(i(e)).toHaveFocus(),await o.keyboard("{Enter}"),await a(f(e)).not.toBeNull()}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  name: "Rich, with formatting",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...E.parameters?.docs?.source}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Plain, reopened from Markdown",
  args: {
    startIn: "plain",
    initialText: PLAIN_MARKDOWN
  }
}`,...C.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source},description:{story:"Cancel changes nothing: the mode stays rich, the document is untouched, and\nfocus comes back to the control that was pressed. `aria-pressed` never flips\noptimistically.",...m.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
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
}`,...S.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
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
}`,...p.parameters?.docs?.source},description:{story:"Nothing but paragraphs and a blank line: switching changes nothing, so nothing is asked.",...p.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
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
}`,...h.parameters?.docs?.source},description:{story:`An underlined word exports identical to its own characters, so a comparison
of the two strings would switch in silence and destroy it. The rule reads the
document instead.`,...h.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
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
}`,...k.parameters?.docs?.source}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
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
}`,...w.parameters?.docs?.source},description:{story:"Switching an ordinary note to rich must not reflow it.",...w.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
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
}`,...g.parameters?.docs?.source},description:{story:`A conversion that would blank a written message does not happen: autosave
would persist the empty body a moment later and the draft would be gone with
nothing said.`,...g.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
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
}`,...y.parameters?.docs?.source},description:{story:"One Shift+Tab out of the body reaches the toggle, and Enter acts.",...y.parameters?.docs?.description}}};const Be=["RichDocument","PlainDraft","WarningCancelled","WarningConfirmed","PlainProseSwitchesSilently","UnderlineStillWarns","PlainToRich","PlainProseToRich","ConversionCameBackEmpty","ReachableFromTheBody"];export{g as ConversionCameBackEmpty,C as PlainDraft,p as PlainProseSwitchesSilently,w as PlainProseToRich,k as PlainToRich,y as ReachableFromTheBody,E as RichDocument,h as UnderlineStillWarns,m as WarningCancelled,S as WarningConfirmed,Be as __namedExportsOrder,Re as default};
