import{S as a}from"./search-conversion-notice-PJ-CxcLG.js";import"./iframe-fAVmrNjG.js";import"./preload-helper-PPVm8Dsz.js";import"./folder-input-CNYzPMSE.js";import"./createLucideIcon-E7hVbHyY.js";import"./info-1t6AlOvJ.js";import"./sparkles-DroEPvOz.js";const l={title:"Filters/Search conversion notice",component:a,parameters:{layout:"centered"}},e={args:{notice:{scopedOutFolder:"Archive"}}},r={args:{notice:{droppedFacets:["Has attachment","Unread","Before 2026-01-01"]}}},t={args:{notice:{droppedSemantic:!0}}},o={args:{notice:{scopedOutFolder:"Archive",droppedFacets:["Has attachment","Before 2026-01-01"],droppedSemantic:!0}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    notice: {
      scopedOutFolder: "Archive"
    }
  }
}`,...e.parameters?.docs?.source},description:{story:"A folder-scoped search: the filter cannot be pinned to the folder.",...e.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    notice: {
      droppedFacets: ["Has attachment", "Unread", "Before 2026-01-01"]
    }
  }
}`,...r.parameters?.docs?.source},description:{story:"Attribute facets that are not filter conditions, named rather than dropped silently.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    notice: {
      droppedSemantic: true
    }
  }
}`,...t.parameters?.docs?.source},description:{story:"A deployment that cannot match by meaning — literal words kept, no similarity claim.",...t.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    notice: {
      scopedOutFolder: "Archive",
      droppedFacets: ["Has attachment", "Before 2026-01-01"],
      droppedSemantic: true
    }
  }
}`,...o.parameters?.docs?.source},description:{story:"Everything a rich search carried that the filter cannot.",...o.parameters?.docs?.description}}};const h=["FolderScopedOut","DroppedFacets","DroppedSemantic","Everything"];export{r as DroppedFacets,t as DroppedSemantic,o as Everything,e as FolderScopedOut,h as __namedExportsOrder,l as default};
