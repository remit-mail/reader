import{j as n}from"./iframe-uufGNBEn.js";import{R as o}from"./recurrence-scope-prompt-CKFLKLE7.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-Wi0n0Lyz.js";const i={title:"Calendar/Recurrence scope",component:o,parameters:{layout:"padded",docs:{description:{component:`The scope question, asked before the form opens. Editing one instance and
editing the rule are different acts, so the choice is made while the change
is still an intention.`}}}},r={render:()=>n.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface-raised p-4",children:n.jsx(o,{title:"Standup",ruleText:"Every weekday, 09:15",instanceText:"Wednesday 10 June",onChoose:()=>{},onCancel:()=>{}})})},e={render:()=>n.jsx("div",{className:"max-w-sm rounded-lg border border-line bg-surface-raised p-4",children:n.jsx(o,{title:"Standup",ruleText:"Every weekday, 09:15",instanceText:"Wednesday 10 June",onChoose:()=>{},onCancel:()=>{},touch:!0})})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
            <RecurrenceScopePrompt title="Standup" ruleText="Every weekday, 09:15" instanceText="Wednesday 10 June" onChoose={() => {}} onCancel={() => {}} />
        </div>
}`,...r.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  render: () => <div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
            <RecurrenceScopePrompt title="Standup" ruleText="Every weekday, 09:15" instanceText="Wednesday 10 June" onChoose={() => {}} onCancel={() => {}} touch />
        </div>
}`,...e.parameters?.docs?.source},description:{story:"The same question with thumb-sized targets.",...e.parameters?.docs?.description}}};const p=["Desktop","Touch"];export{r as Desktop,e as Touch,p as __namedExportsOrder,i as default};
