import{j as d}from"./iframe-uufGNBEn.js";import{O as i}from"./outbox-row-C4A7vZ3R.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./roving-focus-C30yPp50.js";import"./triangle-alert-BMnL-Txz.js";import"./createLucideIcon-Bn-Stmx4.js";import"./circle-alert-Dg_Tz5Bw.js";import"./circle-check-big-Dgk_nr-K.js";import"./loader-circle-qkSTSuP1.js";import"./clock-Cx4gZNlA.js";import"./row-actions-DNQQUGve.js";import"./button-Wi0n0Lyz.js";import"./trash-2-RI1RlAl9.js";import"./rotate-ccw-DZWDNomw.js";import"./send-Auw0BsZV.js";const k={title:"Mail/OutboxRow",component:i,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"unfiled",error:"Sent, but not filed: this account has no Sent folder. Create one named Sent and later messages will be filed there."}},a={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},n={args:{status:"queued",selected:!0}},c={name:"Empty list",render:()=>d.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
