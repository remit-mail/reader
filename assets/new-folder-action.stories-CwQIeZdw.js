import{j as e}from"./iframe-BxLfZl0d.js";import{F as t}from"./folder-row-B7bqIcao.js";import{N as n}from"./new-folder-action-CYLRlXtB.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./chevron-right-C4q9meQG.js";import"./createLucideIcon-DDkWk8mg.js";import"./check-DP9bkLrx.js";import"./folder-BIbRcK0i.js";const h={title:"Mail/NewFolderAction",component:n,parameters:{layout:"centered"}};function d({children:i}){return e.jsx("div",{className:"w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg",children:i})}const r={name:"Prominent (pinned above the list)",render:()=>e.jsx(d,{children:e.jsx(n,{label:"New folder",ariaLabel:"New folder",onOpen:()=>{}})})},a={name:"Quiet (inside an opened folder)",render:()=>e.jsxs(d,{children:[e.jsx(t,{label:"Travel",depth:0,expanded:!0,ariaLabel:"Move to Travel",separated:!0}),e.jsx(t,{label:"Hotels",depth:1,expanded:!1,ariaLabel:"Move to Hotels",separated:!0}),e.jsx(n,{label:"New folder",ariaLabel:"New folder inside Travel",depth:1,prominence:"quiet",onOpen:()=>{}})]})},o={name:"Both treatments at once",render:()=>e.jsxs(d,{children:[e.jsx(n,{label:"New folder",ariaLabel:"New folder",onOpen:()=>{}}),e.jsx(t,{label:"Finance",depth:0,expanded:!0,ariaLabel:"Move to Finance",separated:!0}),e.jsx(n,{label:"New folder",ariaLabel:"New folder inside Finance",depth:1,prominence:"quiet",onOpen:()=>{}})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source},description:{story:"The last thing inside an opened folder, subordinate to the folder it sits in.",...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Both treatments at once",
  render: () => <List>
            <NewFolderAction label="New folder" ariaLabel="New folder" onOpen={() => undefined} />
            <FolderRow label="Finance" depth={0} expanded ariaLabel="Move to Finance" separated />
            <NewFolderAction label="New folder" ariaLabel="New folder inside Finance" depth={1} prominence="quiet" onOpen={() => undefined} />
        </List>
}`,...o.parameters?.docs?.source}}};const N=["Prominent","Quiet","BothTreatments"];export{o as BothTreatments,r as Prominent,a as Quiet,N as __namedExportsOrder,h as default};
