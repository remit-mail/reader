import{j as e,r as u}from"./iframe-uufGNBEn.js";import{F as i}from"./folder-rename-dialog-BSBkEKp7.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Wi0n0Lyz.js";import"./cn-d2XQ1MEC.js";import"./dialog-DIXzXjmg.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-initial-focus-BI_G8RKS.js";import"./dialog-backdrop-Cp-aOj13.js";import"./field-label-Bp6oPTgY.js";import"./input-Cs8KaoXd.js";import"./x-CuwWA0oJ.js";import"./createLucideIcon-Bn-Stmx4.js";const R={title:"Mail/FolderRenameDialog",component:i,parameters:{layout:"fullscreen"}};function a({initialName:m="Trash",pending:d,error:l}){const[c,p]=u.useState(m);return e.jsx("div",{className:"h-screen bg-canvas font-sans",children:e.jsx(i,{open:!0,folderLabel:"Trash",defaultLabel:"Deleted Messages",name:c,onNameChange:p,onSubmit:()=>{},onClose:()=>{},pending:d,error:l})})}const o={name:"Renaming an appointed folder",render:()=>e.jsx(a,{})},r={name:"Name cleared",render:()=>e.jsx(a,{initialName:""})},n={name:"Saving",render:()=>e.jsx(a,{pending:!0})},s={name:"The save failed",render:()=>e.jsx(a,{error:"Couldn't save that name. Please try again."})},t={name:"Phone",globals:{viewport:{value:"mobile"}},render:()=>e.jsx(a,{})};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Renaming an appointed folder",
  render: () => <Live />
}`,...o.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Name cleared",
  render: () => <Live initialName="" />
}`,...r.parameters?.docs?.source},description:{story:"Cleared: the folder goes back to what the mail server calls it.",...r.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Saving",
  render: () => <Live pending />
}`,...n.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "The save failed",
  render: () => <Live error="Couldn't save that name. Please try again." />
}`,...s.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <Live />
}`,...t.parameters?.docs?.source}}};const y=["Default","Cleared","Saving","Failed","Phone"];export{r as Cleared,o as Default,s as Failed,t as Phone,n as Saving,y as __namedExportsOrder,R as default};
