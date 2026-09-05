import{j as h}from"./iframe-uufGNBEn.js";import{B as u,S as y}from"./brief-section-DvHJzvM1.js";import{C as f}from"./message-row-yrY4apdT.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./chevron-right-B0dowht5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./roving-focus-C30yPp50.js";import"./app-shell-types--0yhHeoL.js";import"./avatar-B5mDLuXx.js";import"./badge-DS2l7jE5.js";import"./label-chip-ua_lHL4v.js";import"./message-settlement-BieSBZWI.js";import"./cloud-off-CdsVd9RG.js";import"./shield-alert-CwV1s3Qj.js";import"./star-Cwq7Iobx.js";import"./paperclip-BZCOJKRZ.js";import"./check-BSgP79ub.js";function S(e){return{id:`t${e}`,accountId:"a1",fromName:`Sender ${e}`,fromEmail:`sender${e}@example.com`,subject:`Subject line ${e}`,snippet:"A short preview of the message body.",timeLabel:`9:0${e%10}`,isRead:e%2===0,category:"personal"}}const m=e=>Array.from({length:e},(v,w)=>S(w+1)),b={id:"transactional",label:"Transactional",threads:m(3),total:{kind:"exact",value:3}},g={id:"newsletter",label:"Newsletter",threads:m(18)},l={id:"marketing",label:"Marketing",threads:m(y),total:{kind:"exact",value:3942}},D={title:"Screens/Kit/BriefSection",component:u,parameters:{layout:"fullscreen"},args:{Row:f,onSelectThread:()=>{}},render:e=>h.jsx("div",{className:"flex h-screen w-96 flex-col border-r border-line",children:h.jsx(u,{...e})})},r={args:{section:b}},t={args:{section:l,onShowAll:()=>{}}},o={args:{section:{...l,total:void 0}}},s={args:{section:{...l,threads:[],loading:!0}}},a={args:{section:{...l,threads:[],error:!0},onRetry:()=>{}}},n={args:{section:{id:"personal",label:"Personal",threads:[]}}},i={args:{section:{id:"uncategorized",label:"Unclassified",threads:m(4).map(e=>({...e,category:"uncategorized"})),total:{kind:"exact",value:4}}}},c={args:{section:g}},d={args:{section:g,initialExpanded:!0}},p={args:{section:l,initialCollapsed:!0}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    section: shortSection
  }
}`,...r.parameters?.docs?.source},description:{story:"Fewer than the cap — the total is the rows, and there is nowhere else to go.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    section: cappedSection,
    onShowAll: () => undefined
  }
}`,...t.parameters?.docs?.source},description:{story:"The header total is the category's, counted by the server, and it stays put\nhowever many rows the section holds. Ten rows under `Marketing 3,942`, with the\nway to the rest beneath them.",...t.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    section: {
      ...cappedSection,
      total: undefined
    }
  }
}`,...o.parameters?.docs?.source},description:{story:"A section nobody counted — an account pill or a `before:` term is narrowing the\nrows after they arrive, so the server's number is of a wider set than the list.\nIt renders no number rather than one that is not the section's size.",...o.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    section: {
      ...cappedSection,
      threads: [],
      loading: true
    }
  }
}`,...s.parameters?.docs?.source},description:{story:`The rows are still in flight. Distinct from a section that came back empty:
the total is already known, and the treatment says the rows are coming.`,...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    section: {
      ...cappedSection,
      threads: [],
      error: true
    },
    onRetry: () => undefined
  }
}`,...a.parameters?.docs?.source},description:{story:`This section's own request failed. Each section is its own query, so the
failure states itself here and offers the way to ask again while the rest of
the brief stands.`,...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    section: {
      id: "personal",
      label: "Personal",
      threads: []
    }
  }
}`,...n.parameters?.docs?.source},description:{story:`A chip narrowed the section to nothing. The section says so in its own words,
and drops its number — a real total above zero rows reads as a broken list.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    section: {
      id: "uncategorized",
      label: "Unclassified",
      threads: rows(4).map(row => ({
        ...row,
        category: "uncategorized"
      })),
      total: {
        kind: "exact",
        value: 4
      }
    }
  }
}`,...i.parameters?.docs?.source},description:{story:"`uncategorized` is its own section with its own label, last in the order,\nnever folded into Personal (D6, issue #45).",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    section: longSection
  }
}`,...c.parameters?.docs?.source},description:{story:"Over the cap with no total — the local expander, for a complete fixture set.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    section: longSection,
    initialExpanded: true
  }
}`,...d.parameters?.docs?.source},description:{story:'The same section after expanding — every row visible, "Show less" to collapse.',...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    section: cappedSection,
    initialCollapsed: true
  }
}`,...p.parameters?.docs?.source},description:{story:"Section collapsed by its header — only the label + total show, every row hidden.",...p.parameters?.docs?.description}}};const M=["Short","CategoryTotal","NoTotal","Loading","Failed","EmptyUnderFilter","Unclassified","CollapsedAtCap","Expanded","SectionCollapsed"];export{t as CategoryTotal,c as CollapsedAtCap,n as EmptyUnderFilter,d as Expanded,a as Failed,s as Loading,o as NoTotal,p as SectionCollapsed,r as Short,i as Unclassified,M as __namedExportsOrder,D as default};
