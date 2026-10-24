import{j as d}from"./iframe-DS5xN_9u.js";import{O as i}from"./outbox-row-DXQl5wAF.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./roving-focus-B2gCdtQ1.js";import"./triangle-alert-WlZ9QUbm.js";import"./createLucideIcon-C2HcSaX7.js";import"./circle-alert-B85b9V8q.js";import"./circle-check-big-BtZwwpdI.js";import"./loader-circle-BUYpZ_2j.js";import"./clock-BZ82kvHk.js";import"./row-actions-CrwU2YbJ.js";import"./button-D5VdN6KM.js";import"./trash-2-DgSzqfOe.js";import"./rotate-ccw-DGXf09u8.js";import"./send-DjOzwleH.js";const k={title:"Design System/Mail/OutboxRow",component:i,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"unfiled",error:"Sent, but not filed: this account has no Sent folder. Create one named Sent and later messages will be filed there."}},a={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},n={args:{status:"queued",selected:!0}},c={name:"Empty list",render:()=>d.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
    status: "unfiled",
    error: "Sent, but not filed: this account has no Sent folder. Create one named Sent and later messages will be filed there."
  }
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    status: "failed",
    error: "SMTP connection refused",
    onRetry: () => undefined
  }
}`,...a.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    status: "blocked",
    error: "SMTP not configured for this account"
  }
}`,...o.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    status: "queued",
    selected: true
  }
}`,...n.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Empty list",
  render: () => <div className="flex h-32 items-center justify-center text-sm text-fg-muted">
            No outbox messages
        </div>
}`,...c.parameters?.docs?.source}}};const q=["Queued","Sending","Sent","Unfiled","Failed","Blocked","Selected","Empty"];export{o as Blocked,c as Empty,a as Failed,e as Queued,n as Selected,r as Sending,s as Sent,t as Unfiled,q as __namedExportsOrder,k as default};
