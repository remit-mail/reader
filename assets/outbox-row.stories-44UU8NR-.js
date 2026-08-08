import{j as c}from"./iframe-zw88L4Mq.js";import{O as m}from"./outbox-row-Fg09l3t_.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./roving-focus-5ii5MRPr.js";import"./triangle-alert-DvQXczKn.js";import"./createLucideIcon-AdIgPHc_.js";import"./circle-alert-CC5hBMsl.js";import"./circle-check-big-DK4jhiq0.js";import"./loader-circle-C8k5aq3T.js";import"./clock-C5sAgOYf.js";import"./row-actions-tHMgymn_.js";import"./button-B3Yk1mOK.js";import"./trash-2-Du3oCQXI.js";import"./rotate-ccw-Cn64w34n.js";import"./send-BN5Q90Ut.js";const R={title:"Mail/OutboxRow",component:m,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},a={args:{status:"queued",selected:!0}},n={name:"Empty list",render:()=>c.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    status: "queued"
  }
}`,...e.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    status: "sending"
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    status: "sent"
  }
}`,...s.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    status: "failed",
    error: "SMTP connection refused",
    onRetry: () => undefined
  }
}`,...t.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    status: "blocked",
    error: "SMTP not configured for this account"
  }
}`,...o.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    status: "queued",
    selected: true
  }
}`,...a.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Empty list",
  render: () => <div className="flex h-32 items-center justify-center text-sm text-fg-muted">
            No outbox messages
        </div>
}`,...n.parameters?.docs?.source}}};const k=["Queued","Sending","Sent","Failed","Blocked","Selected","Empty"];export{o as Blocked,n as Empty,t as Failed,e as Queued,a as Selected,r as Sending,s as Sent,k as __namedExportsOrder,R as default};
