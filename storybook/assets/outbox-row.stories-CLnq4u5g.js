import{j as d}from"./iframe-R-hq3KXP.js";import{O as i}from"./outbox-row-BoNfJi1S.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./roving-focus-j7U1alvJ.js";import"./triangle-alert-BzRaASrO.js";import"./createLucideIcon-BDKPi14T.js";import"./circle-alert-CbTBTlom.js";import"./circle-check-big-06gH2bue.js";import"./loader-circle-SNCXCa6F.js";import"./clock-Ba7zFhDt.js";import"./row-actions-suXcHz2w.js";import"./button-DALtMcT0.js";import"./trash-2-DVhxVVfp.js";import"./rotate-ccw-D55nAw9v.js";import"./send-fSuxqJkf.js";const k={title:"Mail/OutboxRow",component:i,parameters:{layout:"padded"},args:{recipients:"alex@example.com +2",subject:"Q3 planning notes",time:"9:42",onSelect:()=>{},onEdit:()=>{},onDelete:()=>{}}},e={args:{status:"queued"}},r={args:{status:"sending"}},s={args:{status:"sent"}},t={args:{status:"unfiled",error:"Sent, but not filed: this account has no Sent folder. Create one named Sent and later messages will be filed there."}},a={args:{status:"failed",error:"SMTP connection refused",onRetry:()=>{}}},o={args:{status:"blocked",error:"SMTP not configured for this account"}},n={args:{status:"queued",selected:!0}},c={name:"Empty list",render:()=>d.jsx("div",{className:"flex h-32 items-center justify-center text-sm text-fg-muted",children:"No outbox messages"})};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
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
