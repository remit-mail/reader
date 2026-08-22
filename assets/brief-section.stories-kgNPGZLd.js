import{j as i}from"./iframe-BxLfZl0d.js";import{B as c}from"./brief-section-BmvtQzHO.js";import{C as d}from"./message-row-CyiafRov.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-DBsC1ZFK.js";import"./createLucideIcon-DDkWk8mg.js";import"./roving-focus-C9a9OTc4.js";import"./app-shell-types-BijkK5CA.js";import"./avatar-B9NbFnlE.js";import"./badge-Bz4-5UiN.js";import"./label-chip-z1uWipku.js";import"./shield-alert-Beo-XT4k.js";import"./star-BnMPyPKH.js";import"./paperclip-BuRqVWrf.js";import"./check-DP9bkLrx.js";function p(e){return{id:`t${e}`,accountId:"a1",fromName:`Sender ${e}`,fromEmail:`sender${e}@example.com`,subject:`Subject line ${e}`,snippet:"A short preview of the message body.",timeLabel:`9:0${e%10}`,isRead:e%2===0,category:"personal"}}const l={id:"transactional",label:"Transactional",threads:Array.from({length:3},(e,a)=>p(a+1))},n={id:"newsletter",label:"Newsletter",threads:Array.from({length:18},(e,a)=>p(a+1))},$={title:"Screens/Kit/BriefSection",component:c,parameters:{layout:"fullscreen"},args:{Row:d,onSelectThread:()=>{}},render:e=>i.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:i.jsx(c,{...e})})},r={args:{section:l}},o={args:{section:n}},t={args:{section:n,initialExpanded:!0}},s={args:{section:n,initialCollapsed:!0}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    section: shortSection
  }
}`,...r.parameters?.docs?.source},description:{story:"Fewer than the cap — no expander.",...r.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    section: longSection
  }
}`,...o.parameters?.docs?.source},description:{story:'Over the cap — shows the first 10 rows and a "Show N more" control.',...o.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    section: longSection,
    initialExpanded: true
  }
}`,...t.parameters?.docs?.source},description:{story:'The same section after expanding — every row visible, "Show less" to collapse.',...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    section: longSection,
    initialCollapsed: true
  }
}`,...s.parameters?.docs?.source},description:{story:"Section collapsed by its header — only the label + count show, every row hidden.",...s.parameters?.docs?.description}}};const N=["Short","CollapsedAtCap","Expanded","SectionCollapsed"];export{o as CollapsedAtCap,t as Expanded,s as SectionCollapsed,r as Short,N as __namedExportsOrder,$ as default};
