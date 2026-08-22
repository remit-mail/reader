import{j as e}from"./iframe-BxLfZl0d.js";import{F as r}from"./folder-row-B7bqIcao.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./chevron-right-C4q9meQG.js";import"./createLucideIcon-DDkWk8mg.js";import"./check-DP9bkLrx.js";import"./folder-BIbRcK0i.js";const v={title:"Mail/FolderRow",component:r,parameters:{layout:"centered"}};function o({children:l}){return e.jsx("div",{className:"w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg",children:l})}const n={name:"Closed",render:()=>e.jsx(o,{children:e.jsx(r,{label:"Travel",depth:0,expanded:!1,ariaLabel:"Move to Travel",tabIndex:0})})},s={name:"Open, with its children indented under it",render:()=>e.jsxs(o,{children:[e.jsx(r,{label:"Travel",depth:0,expanded:!0,ariaLabel:"Move to Travel",separated:!0}),e.jsx(r,{label:"Hotels",depth:1,expanded:!1,ariaLabel:"Move to Hotels",separated:!0}),e.jsx(r,{label:"Flights",depth:1,expanded:!1,ariaLabel:"Move to Flights"})]})},d={name:"The destination",render:()=>e.jsx(o,{children:e.jsx(r,{label:"Hotels",depth:1,expanded:!1,selected:!0,ariaLabel:"Move to Hotels"})})},a={name:"The folder you are in",render:()=>e.jsx(o,{children:e.jsx(r,{label:"Inbox",depth:0,expanded:!1,current:!0,currentTag:"current",ariaLabel:"Inbox (current folder)"})})},t={name:"A branch held open by a match below it",render:()=>e.jsxs(o,{children:[e.jsx(r,{label:"Travel",depth:0,expanded:!0,context:!0,ariaLabel:"Travel (containing folder)",separated:!0}),e.jsx(r,{label:"Hotels",depth:1,expanded:!1,ariaLabel:"Move to Hotels"})]})};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Closed",
  render: () => <List>
            <FolderRow label="Travel" depth={0} expanded={false} ariaLabel="Move to Travel" tabIndex={0} />
        </List>
}`,...n.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Open, with its children indented under it",
  render: () => <List>
            <FolderRow label="Travel" depth={0} expanded ariaLabel="Move to Travel" separated />
            <FolderRow label="Hotels" depth={1} expanded={false} ariaLabel="Move to Hotels" separated />
            <FolderRow label="Flights" depth={1} expanded={false} ariaLabel="Move to Flights" />
        </List>
}`,...s.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "The destination",
  render: () => <List>
            <FolderRow label="Hotels" depth={1} expanded={false} selected ariaLabel="Move to Hotels" />
        </List>
}`,...d.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  name: "The folder you are in",
  render: () => <List>
            <FolderRow label="Inbox" depth={0} expanded={false} current currentTag="current" ariaLabel="Inbox (current folder)" />
        </List>
}`,...a.parameters?.docs?.source},description:{story:"Where the messages live now: a marker, never a disabled control.",...a.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "A branch held open by a match below it",
  render: () => <List>
            <FolderRow label="Travel" depth={0} expanded context ariaLabel="Travel (containing folder)" separated />
            <FolderRow label="Hotels" depth={1} expanded={false} ariaLabel="Move to Hotels" />
        </List>
}`,...t.parameters?.docs?.source},description:{story:"A branch on screen only to hold the match under it: it reads, it never operates.",...t.parameters?.docs?.description}}};const L=["Closed","Open","Selected","Current","Context"];export{n as Closed,t as Context,a as Current,s as Open,d as Selected,L as __namedExportsOrder,v as default};
