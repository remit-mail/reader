import{j as e}from"./iframe-uTafckjr.js";import{F as t}from"./folder-row-DZMO-O7o.js";import{N as o}from"./new-folder-action-B-nGGx8f.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./chevron-right-BFILk7Cj.js";import"./createLucideIcon-DLYy-DY-.js";import"./check-CM0cWxPP.js";import"./folder-B8XGFRcf.js";const N={title:"Mail/NewFolderAction",component:o,parameters:{layout:"centered"}};function d({children:i}){return e.jsx("div",{className:"w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg",children:i})}const r={name:"Prominent (pinned above the list)",render:()=>e.jsx(d,{children:e.jsx(o,{label:"New folder",ariaLabel:"New folder",onOpen:()=>{}})})},a={name:"Quiet (inside an opened folder)",render:()=>e.jsxs(d,{children:[e.jsx(t,{label:"Travel",depth:0,expanded:!0,ariaLabel:"Move to Travel",separated:!0}),e.jsx(t,{label:"Hotels",depth:1,expanded:!1,ariaLabel:"Move to Hotels",separated:!0}),e.jsx(o,{label:"New folder",ariaLabel:"New folder inside Travel",depth:1,prominence:"quiet",onOpen:()=>{}})]})},n={name:"Both treatments at once",render:()=>e.jsxs(d,{children:[e.jsx(o,{label:"New folder",ariaLabel:"New folder",onOpen:()=>{}}),e.jsx(t,{label:"Finance",depth:0,expanded:!0,ariaLabel:"Move to Finance",separated:!0}),e.jsx(o,{label:"New folder",ariaLabel:"New folder inside Finance",depth:1,prominence:"quiet",onOpen:()=>{}})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Prominent (pinned above the list)",
  render: () => <List>
            <NewFolderAction label="New folder" ariaLabel="New folder" onOpen={() => undefined} />
        </List>
}`,...r.parameters?.docs?.source},description:{story:"Pinned above a list, where it is the loudest thing a folder tree offers.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "Quiet (inside an opened folder)",
  render: () => <List>
            <FolderRow label="Travel" depth={0} expanded ariaLabel="Move to Travel" separated />
            <FolderRow label="Hotels" depth={1} expanded={false} ariaLabel="Move to Hotels" separated />
            <NewFolderAction label="New folder" ariaLabel="New folder inside Travel" depth={1} prominence="quiet" onOpen={() => undefined} />
        </List>
}`,...a.parameters?.docs?.source},description:{story:"The last thing inside an opened folder, subordinate to the folder it sits in.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Both treatments at once",
  render: () => <List>
            <NewFolderAction label="New folder" ariaLabel="New folder" onOpen={() => undefined} />
            <FolderRow label="Finance" depth={0} expanded ariaLabel="Move to Finance" separated />
            <NewFolderAction label="New folder" ariaLabel="New folder inside Finance" depth={1} prominence="quiet" onOpen={() => undefined} />
        </List>
}`,...n.parameters?.docs?.source}}};const x=["Prominent","Quiet","BothTreatments"];export{n as BothTreatments,r as Prominent,a as Quiet,x as __namedExportsOrder,N as default};
