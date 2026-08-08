import{j as c}from"./iframe-uTafckjr.js";import{O as m}from"./outbox-row-CLVkQ2Io.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./roving-focus-p6qmQgLR.js";import"./triangle-alert-nDKVGVDQ.js";import"./createLucideIcon-DLYy-DY-.js";import"./circle-alert-DcdQfpU2.js";import"./circle-check-big-CQYj_1V8.js";import"./loader-circle-BjZYR62R.js";import"./clock-DBNchxVL.js";import"./row-actions-2KkXYPb9.js";import"./button-DCXIHjmE.js";import"./trash-2-CHrpvC8V.js";import"./rotate-ccw-B0TRhxvf.js";import"./send-BQNBpU1Y.js";const k={title:"Mail/OutboxRow",component:m,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},a={args:{status:"queued",selected:!0}},n={name:"Empty list",render:()=>c.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
}`,...n.parameters?.docs?.source}}};const q=["Queued","Sending","Sent","Failed","Blocked","Selected","Empty"];export{o as Blocked,n as Empty,t as Failed,e as Queued,a as Selected,r as Sending,s as Sent,q as __namedExportsOrder,k as default};
