import{j as e,r as l}from"./iframe-uTafckjr.js";import{R as c}from"./rescue-candidate-row-CMKefUHL.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./avatar-DtwcLlyW.js";import"./badge-DAIFEfjj.js";import"./checkbox-Cyff3cc_.js";import"./check-CM0cWxPP.js";import"./createLucideIcon-DLYy-DY-.js";import"./minus-Bt1V8959.js";import"./sender-trust-indicator-CyWvtEPg.js";import"./sparkles-GqOr5y8Y.js";import"./shield-check-CbkYj6D-.js";const W={title:"Components/RescueCandidateRow",component:c,parameters:{layout:"padded"},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-md divide-y divide-line rounded-xl border border-line bg-surface",children:e.jsx(i,{})})]},s={id:"1",senderName:"Anna de Vries",senderAddress:"anna@studio-noord.nl",subject:"Re: invoice for the September shoot",snippet:"Thanks for the quick turnaround — final files attached as agreed.",trustReason:"We can verify this sender",trustSubReason:"You've emailed them before",senderTrust:"wellknown"};function r(i){const[u,m]=l.useState(!0);return e.jsx(c,{candidate:i.candidate,selected:u,onToggle:()=>m(p=>!p)})}const n={render:()=>e.jsx(r,{candidate:s})},t={render:()=>e.jsx(r,{candidate:s})},a={render:()=>e.jsx(r,{candidate:{...s,id:"2",senderName:"GitHub",senderAddress:"noreply@github.com",subject:"[remit] CI passed on rescue-from-spam",snippet:"All checks have passed on your pull request.",trustReason:"We can verify this sender",trustSubReason:"Passed authentication",senderTrust:void 0}})},o={render:()=>e.jsx(r,{candidate:{...s,id:"3",senderName:"Stripe Weekly",senderAddress:"weekly@stripe.com",subject:"Your payouts this week",snippet:"Here is a summary of the payouts settled to your account.",trustReason:"We can verify this sender",trustSubReason:"Known mailing list you read",senderTrust:void 0}})},d={render:()=>e.jsx(r,{candidate:{...s,id:"4",senderName:"Mum",senderAddress:"mum@gmail.com",subject:"dinner sunday?",snippet:"Let me know if you and the kids are coming over.",trustReason:"We can verify this sender",trustSubReason:"Someone you email often",senderTrust:"vip"}})};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive candidate={base} />
}`,...n.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive candidate={base} />
}`,...t.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive candidate={{
    ...base,
    id: "2",
    senderName: "GitHub",
    senderAddress: "noreply@github.com",
    subject: "[remit] CI passed on rescue-from-spam",
    snippet: "All checks have passed on your pull request.",
    trustReason: "We can verify this sender",
    trustSubReason: "Passed authentication",
    senderTrust: undefined
  }} />
}`,...a.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive candidate={{
    ...base,
    id: "3",
    senderName: "Stripe Weekly",
    senderAddress: "weekly@stripe.com",
    subject: "Your payouts this week",
    snippet: "Here is a summary of the payouts settled to your account.",
    trustReason: "We can verify this sender",
    trustSubReason: "Known mailing list you read",
    senderTrust: undefined
  }} />
}`,...o.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive candidate={{
    ...base,
    id: "4",
    senderName: "Mum",
    senderAddress: "mum@gmail.com",
    subject: "dinner sunday?",
    snippet: "Let me know if you and the kids are coming over.",
    trustReason: "We can verify this sender",
    trustSubReason: "Someone you email often",
    senderTrust: "vip"
  }} />
}`,...d.parameters?.docs?.source}}};const I=["Selected","KnownContact","PassedAuthentication","KnownMailingList","Vip"];export{t as KnownContact,o as KnownMailingList,a as PassedAuthentication,n as Selected,d as Vip,I as __namedExportsOrder,W as default};
