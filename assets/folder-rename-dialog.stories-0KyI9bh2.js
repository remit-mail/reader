import{j as e,r as u}from"./iframe-BxLfZl0d.js";import{F as i}from"./folder-rename-dialog-D63O3FQ1.js";import"./preload-helper-PPVm8Dsz.js";import"./button-y3nctzTP.js";import"./cn-d2XQ1MEC.js";import"./dialog-eylec2KB.js";import"./dialog-backdrop-Bi3FaUL6.js";import"./field-label-7InU1Onk.js";import"./input-2W6pRlc_.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";const P={title:"Mail/FolderRenameDialog",component:i,parameters:{layout:"fullscreen"}};function a({initialName:m="Trash",pending:d,error:l}){const[c,p]=u.useState(m);return e.jsx("div",{className:"h-screen bg-canvas font-sans",children:e.jsx(i,{open:!0,folderLabel:"Trash",defaultLabel:"Deleted Messages",name:c,onNameChange:p,onSubmit:()=>{},onClose:()=>{},pending:d,error:l})})}const n={name:"Renaming an appointed folder",render:()=>e.jsx(a,{})},r={name:"Name cleared",render:()=>e.jsx(a,{initialName:""})},o={name:"Saving",render:()=>e.jsx(a,{pending:!0})},s={name:"The save failed",render:()=>e.jsx(a,{error:"Couldn't save that name. Please try again."})},t={name:"Phone",globals:{viewport:{value:"mobile"}},render:()=>e.jsx(a,{})};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Renaming an appointed folder",
  render: () => <Live />
}`,...n.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Name cleared",
  render: () => <Live initialName="" />
}`,...r.parameters?.docs?.source},description:{story:"Cleared: the folder goes back to what the mail server calls it.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Saving",
  render: () => <Live pending />
}`,...o.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
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
}`,...t.parameters?.docs?.source}}};const D=["Default","Cleared","Saving","Failed","Phone"];export{r as Cleared,n as Default,s as Failed,t as Phone,o as Saving,D as __namedExportsOrder,P as default};
