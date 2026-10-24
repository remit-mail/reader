import{j as e,r as u}from"./iframe-DS5xN_9u.js";import{F as i}from"./folder-rename-dialog-NpzdDDh9.js";import"./preload-helper-PPVm8Dsz.js";import"./button-D5VdN6KM.js";import"./cn-d2XQ1MEC.js";import"./dialog-DVqRaD8m.js";import"./overlay-scope-BDkw0-iB.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BzRR042d.js";import"./dialog-backdrop-Nj8MqML8.js";import"./field-label-scIMhTN5.js";import"./input-DvN8Enj2.js";import"./x-BXk_suZj.js";import"./createLucideIcon-C2HcSaX7.js";const y={title:"Design System/Folders/FolderRenameDialog",component:i,parameters:{layout:"fullscreen"}};function a({initialName:m="Trash",pending:d,error:l}){const[c,p]=u.useState(m);return e.jsx("div",{className:"h-screen bg-canvas font-sans",children:e.jsx(i,{open:!0,folderLabel:"Trash",defaultLabel:"Deleted Messages",name:c,onNameChange:p,onSubmit:()=>{},onClose:()=>{},pending:d,error:l})})}const o={name:"Renaming an appointed folder",render:()=>e.jsx(a,{})},r={name:"Name cleared",render:()=>e.jsx(a,{initialName:""})},s={name:"Saving",render:()=>e.jsx(a,{pending:!0})},n={name:"The save failed",render:()=>e.jsx(a,{error:"Couldn't save that name. Please try again."})},t={name:"Phone",globals:{viewport:{value:"mobile"}},render:()=>e.jsx(a,{})};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Renaming an appointed folder",
  render: () => <Live />
}`,...o.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Name cleared",
  render: () => <Live initialName="" />
}`,...r.parameters?.docs?.source},description:{story:"Cleared: the folder goes back to what the mail server calls it.",...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Saving",
  render: () => <Live pending />
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "The save failed",
  render: () => <Live error="Couldn't save that name. Please try again." />
}`,...n.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Phone",
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <Live />
}`,...t.parameters?.docs?.source}}};const R=["Default","Cleared","Saving","Failed","Phone"];export{r as Cleared,o as Default,n as Failed,t as Phone,s as Saving,R as __namedExportsOrder,y as default};
