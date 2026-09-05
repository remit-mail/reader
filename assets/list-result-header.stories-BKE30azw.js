import{j as a}from"./iframe-uufGNBEn.js";import{L as c}from"./list-result-header-D8Lu7T5Y.js";import"./preload-helper-PPVm8Dsz.js";import"./search-DT0jdmVi.js";import"./createLucideIcon-Bn-Stmx4.js";const i=s=>a.jsx("div",{className:"overflow-hidden rounded-lg border border-line bg-canvas",style:{width:360},children:a.jsx(s,{})}),h={title:"Components/ListResultHeader",component:c,parameters:{layout:"centered"},decorators:[i]},e={args:{query:"invoice",count:{kind:"exact",value:1284}}},r={args:{query:"quarterly reconciliation",count:{kind:"exact",value:1}}},t={args:{query:"zzzz",count:{kind:"exact",value:0}}},n={args:{query:"invoice",count:{kind:"unknown"}}},o={args:{query:"consolidated quarterly reconciliation of the shared drive migration",count:{kind:"exact",value:42}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    query: "invoice",
    count: {
      kind: "exact",
      value: 1284
    }
  }
}`,...e.parameters?.docs?.source},description:{story:`The count the server answered for the whole match set. It is the total, not
the length of the pages loaded, so it does not climb as the reader scrolls.`,...e.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    query: "quarterly reconciliation",
    count: {
      kind: "exact",
      value: 1
    }
  }
}`,...r.parameters?.docs?.source},description:{story:"One match reads in the singular.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    query: "zzzz",
    count: {
      kind: "exact",
      value: 0
    }
  }
}`,...t.parameters?.docs?.source},description:{story:"A search that matched nothing states the zero rather than dropping to no number.",...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    query: "invoice",
    count: {
      kind: "unknown"
    }
  }
}`,...n.parameters?.docs?.source},description:{story:`No number at all: the count was not requested, has not arrived, or the
criteria carry an off-row term the server will not count exactly. The header
still names what the list is showing — it never substitutes a page length and
never falls back to zero.`,...n.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    query: "consolidated quarterly reconciliation of the shared drive migration",
    count: {
      kind: "exact",
      value: 42
    }
  }
}`,...o.parameters?.docs?.source},description:{story:"A long query keeps the number readable rather than pushing it off the line.",...o.parameters?.docs?.description}}};const g=["ExactCount","SingleResult","NoResults","CountUnknown","LongQuery"];export{n as CountUnknown,e as ExactCount,o as LongQuery,t as NoResults,r as SingleResult,g as __namedExportsOrder,h as default};
