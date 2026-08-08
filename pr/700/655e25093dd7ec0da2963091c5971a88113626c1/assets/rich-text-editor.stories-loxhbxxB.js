import{j as a}from"./iframe-fAVmrNjG.js";import{ai as y}from"./rich-text-document-DpH6yo8g.js";import{C as w}from"./compose-language-chip-DWloZnix.js";import{C as f}from"./compose-mode-toggle-CWTFTwpF.js";import{R as T}from"./rich-text-editor-RydjzB4B.js";import"./preload-helper-PPVm8Dsz.js";import"./purify.es-2FREwzWT.js";import"./cn-yMAG7bfM.js";import"./compose-language-CBWlIzAC.js";import"./roving-focus-BJjVMA6b.js";import"./button-C4vqyepI.js";import"./index-DW3QNBBN.js";import"./index-Cc1ivA9Z.js";import"./createLucideIcon-E7hVbHyY.js";import"./undo-2-C1J_oyUf.js";const{expect:n,userEvent:x}=__STORYBOOK_MODULE_TEST__,N={title:"Mail/RichTextEditor",component:T,parameters:{layout:"centered",docs:{description:{component:`The frame is the compose body region at its real geometry — a column with a
height of its own — so the editor is shown claiming the space a composer
gives it rather than only the space its own text needs.`}}},decorators:[e=>a.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:a.jsx(e,{})})]},g=["<h2>Quarterly numbers</h2>","<p>Highlights <strong>this quarter</strong>, with the detail below.</p>","<ul><li>Revenue up 14%</li><li>Costs flat</li></ul>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr>","<tr><td>Americas</td><td>388</td></tr></tbody></table>",'<p>Source: <a href="https://example.com/report">the full report</a>.</p>'].join(""),C=['<meta charset="utf-8">',"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->","<style>.hdr{color:#c00}</style>",'<h3 class="hdr" style="color:#c00;font-family:Verdana">Release checklist</h3>','<ol><li style="margin:0">Cut the tag</li><li>Publish the images</li></ol>','<table style="border:2px dashed #c00"><tbody>',"<tr><th>Step</th><th>Owner</th></tr>","<tr><td>Tag</td><td>Ada</td></tr></tbody></table>",'<img src="http://tracker.example/px.gif" width="1" height="1">','<script>fetch("https://tracker.example/steal")<\/script>'].join(""),h={name:"Empty",args:{}},p={name:"Rich content with a table",args:{initialHtml:g}},s={name:"After pasting a web page",args:{initialHtml:y(C)}},l={name:"Clicking below the last line",args:{initialHtml:"<p>Sounds good. See you at 12:30.</p>"},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),o=e.querySelector("[data-testid=compose-body]");if(!t||!o)throw new Error("the editor is not mounted");const r=t.getBoundingClientRect(),i=document.elementFromPoint(r.left+r.width/2,Math.min(r.bottom-12,window.innerHeight-2));await n(o.contains(i)).toBe(!0),await x.click(o),await n(o).toHaveFocus()}},u=a.jsxs(a.Fragment,{children:[a.jsx(w,{language:"nl",languages:["nl","en","de"],onSelect:()=>{}}),a.jsx(f,{mode:"rich",onToggle:()=>{}})]}),c={name:"Toolbar with the language chip and the mode toggle",args:{initialHtml:g,lang:"nl",trailing:u}},d={name:"Toolbar at 390",args:{initialHtml:g,lang:"nl",trailing:u},decorators:[e=>a.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:a.jsx(e,{})})],play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),o=e.querySelector("[data-testid=compose-format-cluster]"),r=e.querySelector("[data-testid=compose-mode-toggle]"),i=e.querySelector("[data-testid=compose-language-chip]");if(!t||!o||!r||!i)throw new Error("the toolbar is not mounted");await n(o.scrollWidth).toBeGreaterThan(o.clientWidth);const b=t.getBoundingClientRect().right+1;await n(r.getBoundingClientRect().right).toBeLessThanOrEqual(b),await n(i.getBoundingClientRect().left).toBeGreaterThanOrEqual(t.getBoundingClientRect().left),await n(i.getBoundingClientRect().right).toBeLessThanOrEqual(b)}},m={name:"Toolbar over a scrolled body",args:{initialHtml:`${g}${"<p>Another line of the message.</p>".repeat(30)}`,lang:"nl",trailing:u},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),o=e.querySelector("[data-testid=compose-mode-toggle]");if(!t||!o)throw new Error("the toolbar is not mounted");t.scrollTop=400,await n(t.scrollTop).toBeGreaterThan(0),await n(o.getBoundingClientRect().top-t.getBoundingClientRect().top).toBeLessThan(60)}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "Empty",
  args: {}
}`,...h.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Rich content with a table",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...p.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "After pasting a web page",
  args: {
    initialHtml: sanitizeAdoptedHtml(CLIPBOARD_HTML)
  }
}`,...s.parameters?.docs?.source},description:{story:`The document after that clipboard has gone through the paste profile: the
heading, the list and the table survive; the styling, the pixel and the
script do not.`,...s.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "Clicking below the last line",
  args: {
    initialHtml: "<p>Sounds good. See you at 12:30.</p>"
  },
  play: async ({
    canvasElement
  }) => {
    const area = canvasElement.querySelector<HTMLElement>("[data-testid=body-area]");
    const editable = canvasElement.querySelector<HTMLElement>("[data-testid=compose-body]");
    if (!area || !editable) throw new Error("the editor is not mounted");
    const box = area.getBoundingClientRect();
    const underTheText = document.elementFromPoint(box.left + box.width / 2, Math.min(box.bottom - 12, window.innerHeight - 2));
    await expect(editable.contains(underTheText)).toBe(true);
    await userEvent.click(editable);
    await expect(editable).toHaveFocus();
  }
}`,...l.parameters?.docs?.source},description:{story:`A short message leaves most of the body region empty. That region belongs to
the document: the point far below the last line is the editable, and a click
there lands in it.`,...l.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Toolbar with the language chip and the mode toggle",
  args: {
    initialHtml: RICH_DOCUMENT,
    lang: "nl",
    trailing: pinnedControls
  }
}`,...c.parameters?.docs?.source},description:{story:"The toolbar as compose ships it: the formatting cluster, then the two pinned controls.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Toolbar at 390",
  args: {
    initialHtml: RICH_DOCUMENT,
    lang: "nl",
    trailing: pinnedControls
  },
  decorators: [Story => <div data-testid="body-area" className="flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas">
                <Story />
            </div>],
  play: async ({
    canvasElement
  }) => {
    const frame = canvasElement.querySelector<HTMLElement>("[data-testid=body-area]");
    const cluster = canvasElement.querySelector<HTMLElement>("[data-testid=compose-format-cluster]");
    const toggle = canvasElement.querySelector<HTMLElement>("[data-testid=compose-mode-toggle]");
    const chip = canvasElement.querySelector<HTMLElement>("[data-testid=compose-language-chip]");
    if (!frame || !cluster || !toggle || !chip) throw new Error("the toolbar is not mounted");
    await expect(cluster.scrollWidth).toBeGreaterThan(cluster.clientWidth);
    const edge = frame.getBoundingClientRect().right + 1;
    await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
    await expect(chip.getBoundingClientRect().left).toBeGreaterThanOrEqual(frame.getBoundingClientRect().left);
    await expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
  }
}`,...d.parameters?.docs?.source},description:{story:`At 390 the formatting cluster runs out of room. It scrolls inside its own
strip and both pinned controls stay at the right edge, rather than the
cluster pushing them off the screen — which is what a flex child without
\`min-w-0\` does. Two letters is what makes room for a second pinned item here.`,...d.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "Toolbar over a scrolled body",
  args: {
    initialHtml: \`\${RICH_DOCUMENT}\${"<p>Another line of the message.</p>".repeat(30)}\`,
    lang: "nl",
    trailing: pinnedControls
  },
  play: async ({
    canvasElement
  }) => {
    const frame = canvasElement.querySelector<HTMLElement>("[data-testid=body-area]");
    const toggle = canvasElement.querySelector<HTMLElement>("[data-testid=compose-mode-toggle]");
    if (!frame || !toggle) throw new Error("the toolbar is not mounted");
    frame.scrollTop = 400;
    await expect(frame.scrollTop).toBeGreaterThan(0);
    await expect(toggle.getBoundingClientRect().top - frame.getBoundingClientRect().top).toBeLessThan(60);
  }
}`,...m.parameters?.docs?.source},description:{story:`The toolbar and the body share one scroller, so twenty lines of typing would
carry the toolbar off the top with them. It stays at the top of the body
while the text moves under it.`,...m.parameters?.docs?.description}}};const D=["Empty","RichContent","PasteResult","ClickBelowTheText","ToolbarInRich","NarrowToolbar","StickyToolbar"];export{l as ClickBelowTheText,h as Empty,d as NarrowToolbar,s as PasteResult,p as RichContent,m as StickyToolbar,c as ToolbarInRich,D as __namedExportsOrder,N as default};
