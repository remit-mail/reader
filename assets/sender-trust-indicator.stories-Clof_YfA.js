import{j as e}from"./iframe-uufGNBEn.js";import{S as n}from"./sender-trust-indicator-BZdArufL.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./sparkles-CHnxu8zM.js";import"./createLucideIcon-Bn-Stmx4.js";const p={title:"Mail/SenderTrustIndicator",component:n,parameters:{layout:"centered"}},s=({label:a,children:d})=>e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx("span",{className:"w-40 text-sm text-fg-muted",children:a}),d]}),r={name:"Header (md)",render:()=>e.jsxs("div",{className:"space-y-2",children:[e.jsx(s,{label:"vip",children:e.jsx(n,{senderTrust:"vip",size:"md"})}),e.jsx(s,{label:"unknown — new sender",children:e.jsx(n,{senderTrust:"unknown",size:"md"})}),e.jsx(s,{label:"wellknown — silent",children:e.jsx(n,{senderTrust:"wellknown",size:"md"})})]})},l={name:"Inbox row (sm)",render:()=>e.jsxs("div",{className:"space-y-2",children:[e.jsx(s,{label:"vip",children:e.jsx(n,{senderTrust:"vip",size:"sm"})}),e.jsx(s,{label:"unknown — silent on rows",children:e.jsx(n,{senderTrust:"unknown",size:"sm"})}),e.jsx(s,{label:"wellknown — silent",children:e.jsx(n,{senderTrust:"wellknown",size:"sm"})})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Header (md)",
  render: () => <div className="space-y-2">
            <Cell label="vip">
                <SenderTrustIndicator senderTrust="vip" size="md" />
            </Cell>
            <Cell label="unknown — new sender">
                <SenderTrustIndicator senderTrust="unknown" size="md" />
            </Cell>
            <Cell label="wellknown — silent">
                <SenderTrustIndicator senderTrust="wellknown" size="md" />
            </Cell>
        </div>
}`,...r.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  name: "Inbox row (sm)",
  render: () => <div className="space-y-2">
            <Cell label="vip">
                <SenderTrustIndicator senderTrust="vip" size="sm" />
            </Cell>
            <Cell label="unknown — silent on rows">
                <SenderTrustIndicator senderTrust="unknown" size="sm" />
            </Cell>
            <Cell label="wellknown — silent">
                <SenderTrustIndicator senderTrust="wellknown" size="sm" />
            </Cell>
        </div>
}`,...l.parameters?.docs?.source}}};const w=["HeaderSize","RowSize"];export{r as HeaderSize,l as RowSize,w as __namedExportsOrder,p as default};
