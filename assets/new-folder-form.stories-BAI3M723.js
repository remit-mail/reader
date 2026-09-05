import{j as e,r as u}from"./iframe-uufGNBEn.js";import{N as i}from"./new-folder-form-5lRSXSZZ.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Wi0n0Lyz.js";import"./cn-d2XQ1MEC.js";import"./field-label-Bp6oPTgY.js";import"./input-Cs8KaoXd.js";const T={title:"Mail/NewFolderForm",component:i,parameters:{layout:"centered"}};function h({children:s}){return e.jsx("div",{className:"w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg",children:s})}function t({parentLabel:s="Travel",initialName:m="",pending:d,error:p}){const[c,l]=u.useState(m);return e.jsx(h,{children:e.jsx(i,{parentLabel:s,name:c,onNameChange:l,onSubmit:()=>{},onCancel:()=>{},pending:d,error:p})})}const n={name:"Opened, waiting for a name",render:()=>e.jsx(t,{})},o={name:"At the top level",render:()=>e.jsx(t,{parentLabel:"Top level",initialName:"Insurance"})},r={name:"Waiting for the server",render:()=>e.jsx(t,{initialName:"Car hire",pending:!0})},a={name:"Failed (retry in place)",render:()=>e.jsx(t,{initialName:"Car hire",error:"The mail server refused the folder name. Try another one."})};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Opened, waiting for a name",
  render: () => <Form />
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "At the top level",
  render: () => <Form parentLabel="Top level" initialName="Insurance" />
}`,...o.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Waiting for the server",
  render: () => <Form initialName="Car hire" pending />
}`,...r.parameters?.docs?.source},description:{story:"Creating a folder is an IMAP mutation: the form holds until the server confirms.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "Failed (retry in place)",
  render: () => <Form initialName="Car hire" error="The mail server refused the folder name. Try another one." />
}`,...a.parameters?.docs?.source},description:{story:"The failure is stated where it happened; the form stays open to retry.",...a.parameters?.docs?.description}}};const j=["Empty","TopLevel","Pending","Failed"];export{n as Empty,a as Failed,r as Pending,o as TopLevel,j as __namedExportsOrder,T as default};
