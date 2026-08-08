import{Q as l}from"./quoted-text-D1_CEGtJ.js";import"./iframe-fAVmrNjG.js";import"./preload-helper-PPVm8Dsz.js";import"./chevron-down-CV-Txd5h.js";import"./createLucideIcon-E7hVbHyY.js";import"./chevron-right-Chf8xknM.js";const h={title:"Mail/QuotedText",component:l,parameters:{layout:"padded"}},s=`
    <p>Thanks for the quick turnaround on the proposal.</p>
    <p>A couple of follow-ups before Friday:</p>
    <ul>
        <li>Can we confirm the <strong>delivery window</strong>?</li>
        <li>See the earlier thread for the pricing notes:</li>
    </ul>
    <blockquote><p>The original quote stands through end of quarter.</p></blockquote>
    <p>More context on the <a href="https://example.com/brief">shared brief</a>.</p>
`,n=["Thanks for the quick turnaround on the proposal.","","A couple of follow-ups before Friday:","- Can we confirm the delivery window?","- See the earlier thread for the pricing notes."].join(`
`),e={args:{text:n,html:s,senderName:"Dana Whitfield",date:"Jun 24, 2026, 9:14 AM"}},t={args:{text:n,html:s,senderName:"Dana Whitfield",date:"Jun 24, 2026, 9:14 AM"},play:async({canvasElement:o})=>{o.querySelector("button")?.click()}},a={args:{text:n,senderName:"Dana Whitfield"},play:async({canvasElement:o})=>{o.querySelector("button")?.click()}},r={args:{text:n}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    text: quotedPlainText,
    html: quotedHtml,
    senderName: "Dana Whitfield",
    date: "Jun 24, 2026, 9:14 AM"
  }
}`,...e.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    text: quotedPlainText,
    html: quotedHtml,
    senderName: "Dana Whitfield",
    date: "Jun 24, 2026, 9:14 AM"
  },
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector("button")?.click();
  }
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    text: quotedPlainText,
    senderName: "Dana Whitfield"
  },
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector("button")?.click();
  }
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    text: quotedPlainText
  }
}`,...r.parameters?.docs?.source}}};const f=["Collapsed","ExpandedHtml","PlainTextOnly","NoAttribution"];export{e as Collapsed,t as ExpandedHtml,r as NoAttribution,a as PlainTextOnly,f as __namedExportsOrder,h as default};
