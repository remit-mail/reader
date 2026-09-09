import{j as e}from"./iframe-R-hq3KXP.js";import{M as o,a as s}from"./message-settlement-DW47l7ie.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./badge-WI2U-Zts.js";import"./cloud-off-D2hvsVZI.js";import"./createLucideIcon-BDKPi14T.js";const g={title:"Mail/MessageSettlement",parameters:{layout:"padded"}},n="https://github.com/remit-mail/reader/issues/new?title=This+message+was+not+deleted",t={render:()=>e.jsxs("div",{className:"flex w-xl flex-col gap-3",children:[e.jsx(s,{settlement:"delete_failed",onRetry:()=>{},reportHref:n}),e.jsx(s,{settlement:"delete_failed",onRetry:()=>{},retryPending:!0,reportHref:n}),e.jsx(s,{settlement:"move_failed",action:e.jsx("button",{type:"button",className:"font-medium text-accent",children:"Move again"}),reportHref:n})]})},r={name:"Notice (dark)",parameters:{theme:"dark"},render:()=>e.jsx("div",{className:"flex w-xl flex-col gap-3",children:e.jsx(s,{settlement:"delete_failed",onRetry:()=>{},reportHref:n})})},a={render:()=>e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(o,{settlement:"delete_failed"}),e.jsx(o,{settlement:"move_failed"})]})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex w-xl flex-col gap-3">
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} reportHref={reportHref} />
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} retryPending reportHref={reportHref} />
            <MessageSettlementNotice settlement="move_failed" action={<button type="button" className="font-medium text-accent">
                        Move again
                    </button>} reportHref={reportHref} />
        </div>
}`,...t.parameters?.docs?.source},description:{story:`A mutation Remit gave up on (issue #1002), named by the row itself (#1229).

A delete gets a real Retry, not a report-only dead end: giving up puts
\`status\` back to \`active\`, so the ordinary delete endpoint accepts the row
and re-drives it. A move cannot retry that way — the destination the give-up
discarded is recorded nowhere — so its way out is the same folder picker
every other move goes through, passed in as \`action\`. Naming the wrong one
is the defect this replaces: a move that handed back rendered the delete
copy, under a button that deleted the message.`,...t.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Notice (dark)",
  parameters: {
    theme: "dark"
  },
  render: () => <div className="flex w-xl flex-col gap-3">
            <MessageSettlementNotice settlement="delete_failed" onRetry={() => undefined} reportHref={reportHref} />
        </div>
}`,...r.parameters?.docs?.source},description:{story:"The same notice on the dark theme.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex items-center gap-2">
            <MessageSettlementBadge settlement="delete_failed" />
            <MessageSettlementBadge settlement="move_failed" />
        </div>
}`,...a.parameters?.docs?.source},description:{story:"The list-row chip, which carries the label alone — a row may nest no action.",...a.parameters?.docs?.description}}};const h=["Notice","NoticeDark","Badge"];export{a as Badge,t as Notice,r as NoticeDark,h as __namedExportsOrder,g as default};
