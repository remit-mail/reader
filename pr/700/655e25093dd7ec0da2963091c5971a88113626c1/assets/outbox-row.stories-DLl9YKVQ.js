import{j as c}from"./iframe-fAVmrNjG.js";import{O as m}from"./outbox-row-C-Y-Do2F.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./roving-focus-BJjVMA6b.js";import"./triangle-alert-Bel_inG1.js";import"./createLucideIcon-E7hVbHyY.js";import"./circle-alert-CLLSHsxA.js";import"./circle-check-big-_NcXkTEj.js";import"./loader-circle-tGqNKIei.js";import"./clock-VuHhFED6.js";import"./row-actions-D_oZsm3m.js";import"./button-C4vqyepI.js";import"./trash-2-Dodc-R2m.js";import"./rotate-ccw-BjS9qhDp.js";import"./send-B0c-OZLl.js";const R={title:"Mail/OutboxRow",component:m,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},a={args:{status:"queued",selected:!0}},n={name:"Empty list",render:()=>c.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
