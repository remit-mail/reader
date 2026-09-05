import{j as e,r as l}from"./iframe-uufGNBEn.js";import{d as c,a as y,f}from"./recurrence-BtiVw_PT.js";import{C as m}from"./custom-recurrence-WHC78Vzw.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-Wi0n0Lyz.js";import"./dialog-DIXzXjmg.js";import"./overlay-scope-DDGgBdDi.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-initial-focus-BI_G8RKS.js";import"./dialog-backdrop-Cp-aOj13.js";import"./input-Cs8KaoXd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";const t="2026-06-09",w="09:15",W={title:"Calendar/Custom recurrence",component:m,parameters:{layout:"padded",docs:{description:{component:`The rule the derived choices cannot express. Every part of it is a control —
how often, which days, when it stops — and what comes out is the same
sentence the picker reads back. Nobody types an RRULE and nobody is shown
one; the line under each story is what the event would carry.`}}}};function d({seed:u,touch:p}){const[i,h]=l.useState(u);return e.jsxs("div",{className:"flex max-w-sm flex-col gap-4 rounded-lg border border-line bg-surface p-5",children:[e.jsx("h3",{className:"text-lg font-semibold text-fg",children:"Custom recurrence"}),e.jsx(m,{value:i,onChange:h,date:t,suggestedEndDate:y(t),touch:p}),e.jsx("p",{className:"border-t border-line pt-3 text-sm text-fg-muted",children:f(i,t,w)})]})}const r={render:()=>e.jsx(d,{seed:c(t)})},o={name:"Every other week, until October",render:()=>e.jsx(d,{seed:{interval:2,unit:"week",weekdays:[1,4],monthlyMode:"dayOfMonth",ends:{kind:"onDate",date:"2026-10-03"}}})},n={name:"Monthly, read two ways",render:()=>e.jsx(d,{seed:{...c(t),unit:"month",monthlyMode:"weekdayOfMonth"}})},s={name:"Ends after a count",render:()=>e.jsx(d,{seed:{...c(t),ends:{kind:"afterCount",count:13}}})},a={render:()=>e.jsx(d,{seed:c(t),touch:!0})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Editor seed={defaultCustomRecurrence(DATE)} />
}`,...r.parameters?.docs?.source},description:{story:"What it opens as: every week, on the day the event already sits on.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Every other week, until October",
  render: () => <Editor seed={{
    interval: 2,
    unit: "week",
    weekdays: [1, 4],
    monthlyMode: "dayOfMonth",
    ends: {
      kind: "onDate",
      date: "2026-10-03"
    }
  }} />
}`,...o.parameters?.docs?.source},description:{story:`Two days a week, fortnightly, until October. None of that is expressible as
a choice derived from a date, which is the whole reason this exists.`,...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  name: "Monthly, read two ways",
  render: () => <Editor seed={{
    ...defaultCustomRecurrence(DATE),
    unit: "month",
    monthlyMode: "weekdayOfMonth"
  }} />
}`,...n.parameters?.docs?.source},description:{story:`A monthly rule means two different things about the same date — the ninth,
or the second Tuesday — and which one is meant is never derivable. So it is
asked rather than assumed.`,...n.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  name: "Ends after a count",
  render: () => <Editor seed={{
    ...defaultCustomRecurrence(DATE),
    ends: {
      kind: "afterCount",
      count: 13
    }
  }} />
}`,...s.parameters?.docs?.source},description:{story:"An ending counted rather than dated: thirteen times and then it stops.",...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Editor seed={defaultCustomRecurrence(DATE)} touch />
}`,...a.parameters?.docs?.source},description:{story:"The same controls at thumb size, as the phone step renders them.",...a.parameters?.docs?.description}}};const N=["Weekly","EveryOtherWeekUntilOctober","MonthlyReadTwoWays","EndsAfterCount","Touch"];export{s as EndsAfterCount,o as EveryOtherWeekUntilOctober,n as MonthlyReadTwoWays,a as Touch,r as Weekly,N as __namedExportsOrder,W as default};
