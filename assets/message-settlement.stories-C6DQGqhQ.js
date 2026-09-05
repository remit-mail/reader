import{j as e}from"./iframe-uufGNBEn.js";import{M as o,a}from"./message-settlement-BieSBZWI.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-DS2l7jE5.js";import"./cloud-off-CdsVd9RG.js";import"./createLucideIcon-Bn-Stmx4.js";const h={title:"Mail/MessageSettlement",parameters:{layout:"padded"}},n="https://github.com/remit-mail/reader/issues/new?title=This+message+was+not+deleted",t={render:()=>e.jsxs("div",{className:"flex w-xl flex-col gap-3",children:[e.jsx(a,{settlement:"delete_failed",onRetry:()=>{},reportHref:n}),e.jsx(a,{settlement:"delete_failed",onRetry:()=>{},retryPending:!0,reportHref:n})]})},r={name:"Notice (dark)",parameters:{theme:"dark"},render:()=>e.jsx("div",{className:"flex w-xl flex-col gap-3",children:e.jsx(a,{settlement:"delete_failed",onRetry:()=>{},reportHref:n})})},s={render:()=>e.jsx("div",{className:"flex items-center gap-2",children:e.jsx(o,{settlement:"delete_failed"})})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex w-xl flex-col gap-3">
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} reportHref={reportHref} />
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} retryPending reportHref={reportHref} />
        </div>
}`,...t.parameters?.docs?.source},description:{story:`The one unsettled state the wire can prove (issue #1002): a delete Remit
abandoned before it reached the server — most often because the Trash folder
the event named is gone — which handed the row back to the folder the server
still holds the message in.

It gets a real Retry, not a report-only dead end: abandoning puts \`status\`
back to \`active\`, so the ordinary delete endpoint accepts the row and
re-drives it. A move that gave up leaves exactly the fields a move mid-retry
leaves, so it gets no treatment at all — no chip, no notice, no promise.`,...t.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Notice (dark)",
  parameters: {
    theme: "dark"
  },
  render: () => <div className="flex w-xl flex-col gap-3">
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} reportHref={reportHref} />
        </div>
}`,...r.parameters?.docs?.source},description:{story:"The same notice on the dark theme.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex items-center gap-2">
            <MessageSettlementBadge settlement="delete_failed" />
        </div>
}`,...s.parameters?.docs?.source},description:{story:"The list-row chip, which carries the label alone — a row may nest no action.",...s.parameters?.docs?.description}}};const g=["Notice","NoticeDark","Badge"];export{s as Badge,t as Notice,r as NoticeDark,g as __namedExportsOrder,h as default};
