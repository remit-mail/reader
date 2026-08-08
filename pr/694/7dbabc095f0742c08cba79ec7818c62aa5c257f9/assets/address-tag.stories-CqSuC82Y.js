import{j as e}from"./iframe-uTafckjr.js";import{A as o}from"./address-tag-Bh7-YZ4R.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./x-DS_pud-s.js";import"./createLucideIcon-DLYy-DY-.js";const x={title:"Compose/AddressTag",component:o,parameters:{layout:"centered"},args:{onRemove:()=>{}}},a={args:{email:"alex@example.com"}},r={args:{email:"alex@example.com",displayName:"Alex Rivera"}},s={args:{email:"very.long.recipient.address@really-long-domain.example.com"}},m={render:()=>e.jsxs("div",{className:"flex flex-wrap items-center gap-1",children:[e.jsx(o,{email:"alex@example.com",displayName:"Alex Rivera",onRemove:()=>{}}),e.jsx(o,{email:"sam@example.com",onRemove:()=>{}}),e.jsx(o,{email:"very.long.recipient.address@really-long-domain.example.com",onRemove:()=>{}})]})};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    email: "alex@example.com"
  }
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    email: "alex@example.com",
    displayName: "Alex Rivera"
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    email: "very.long.recipient.address@really-long-domain.example.com"
  }
}`,...s.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap items-center gap-1">
            <AddressTag email="alex@example.com" displayName="Alex Rivera" onRemove={() => {}} />
            <AddressTag email="sam@example.com" onRemove={() => {}} />
            <AddressTag email="very.long.recipient.address@really-long-domain.example.com" onRemove={() => {}} />
        </div>
}`,...m.parameters?.docs?.source}}};const g=["EmailOnly","WithDisplayName","LongAddress","Removable"];export{a as EmailOnly,s as LongAddress,m as Removable,r as WithDisplayName,g as __namedExportsOrder,x as default};
