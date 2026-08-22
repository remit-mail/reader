import{j as e,r as d}from"./iframe-BxLfZl0d.js";import{A as o}from"./app-top-bar-CDKnEEHt.js";import{S as c}from"./search-chip-input-BNVUlIsB.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./search-token-chip-Dz97Zxy_.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";import"./search-B2ZXIDXt.js";const j={title:"Mail/AppTopBar",component:o,parameters:{layout:"fullscreen",docs:{description:{component:"The bar's geometry. What fills it — which actions, in what order, with what\nwording — is `ShellTopBar`, which is what the app and the shell prototype\nboth mount; these stories show only the row the slots sit in."}}}},t=({label:n})=>e.jsx("div",{className:"rounded border border-dashed border-line px-2 py-1 text-2xs text-fg-subtle",children:n}),l=()=>{const[n,i]=d.useState("");return e.jsx(c,{size:"lg",value:n,onChange:i,onClear:()=>i(""),onClearQuery:()=>i(""),globalFocusKey:!1,placeholder:"Search all mail"})},s={render:()=>e.jsx(o,{leading:e.jsx(t,{label:"leading"}),search:e.jsx(l,{}),actions:e.jsx(t,{label:"actions"})})},r={render:()=>e.jsx(o,{search:e.jsx(l,{})})},a={render:()=>e.jsxs("div",{className:"flex h-96 flex-col bg-canvas",children:[e.jsx(o,{leading:e.jsx(t,{label:"leading"}),search:e.jsx(l,{}),actions:e.jsx(t,{label:"actions"})}),e.jsxs("div",{className:"flex min-h-0 flex-1",children:[e.jsx("div",{className:"w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted",children:"Nav — under the bar, like every other pane"}),e.jsx("div",{className:"w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted",children:"Message list"}),e.jsx("div",{className:"min-w-0 flex-1 p-3 text-xs text-fg-muted",children:"Message pane — its own toolbar lives here, under the bar"})]})]})};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <AppTopBar leading={<Slot label="leading" />} search={<Field />} actions={<Slot label="actions" />} />
}`,...s.parameters?.docs?.source},description:{story:"Leading · search · actions. The field is the only slot that grows.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <AppTopBar search={<Field />} />
}`,...r.parameters?.docs?.source},description:{story:"With nothing but the field, the bar is still the page's one search surface.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <div className="flex h-96 flex-col bg-canvas">
            <AppTopBar leading={<Slot label="leading" />} search={<Field />} actions={<Slot label="actions" />} />
            <div className="flex min-h-0 flex-1">
                <div className="w-56 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
                    Nav — under the bar, like every other pane
                </div>
                <div className="w-72 shrink-0 border-r border-line bg-surface p-3 text-xs text-fg-muted">
                    Message list
                </div>
                <div className="min-w-0 flex-1 p-3 text-xs text-fg-muted">
                    Message pane — its own toolbar lives here, under the bar
                </div>
            </div>
        </div>
}`,...a.parameters?.docs?.source},description:{story:`One row across the top of the shell, over the nav, the list and the message
 pane alike.`,...a.parameters?.docs?.description}}};const w=["Slots","SearchOnly","OverTheLayout"];export{a as OverTheLayout,r as SearchOnly,s as Slots,w as __namedExportsOrder,j as default};
