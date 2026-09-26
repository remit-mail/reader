import{j as t}from"./iframe-DS5xN_9u.js";import{S as a}from"./spam-results-offer-BDn9uCnF.js";import"./preload-helper-PPVm8Dsz.js";import"./banner-rwqF0cjd.js";import"./cn-d2XQ1MEC.js";import"./button-D5VdN6KM.js";import"./x-BXk_suZj.js";import"./createLucideIcon-C2HcSaX7.js";const c=s=>t.jsx("div",{className:"overflow-hidden rounded-lg border border-line bg-canvas",style:{width:360},children:t.jsx(s,{})}),h={title:"Design System/Spam rescue/SpamResultsOffer",component:a,parameters:{layout:"centered"},decorators:[c]},e={args:{count:{kind:"exact",value:3},onScopeToSpam:()=>{}}},o={args:{count:{kind:"exact",value:1},onScopeToSpam:()=>{}}},n={args:{count:{kind:"exact",value:1284},onScopeToSpam:()=>{}}},r={args:{count:{kind:"unknown"},onScopeToSpam:()=>{}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    count: {
      kind: "exact",
      value: 3
    },
    onScopeToSpam: () => {}
  }
}`,...e.parameters?.docs?.source},description:{story:`Spam matches a global search held out of its results. Deliberately quiet —
an offer, not a warning — and the action scopes the search to Spam rather
than opening a view of its own.`,...e.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    count: {
      kind: "exact",
      value: 1
    },
    onScopeToSpam: () => {}
  }
}`,...o.parameters?.docs?.source},description:{story:"One match reads in the singular.",...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    count: {
      kind: "exact",
      value: 1284
    },
    onScopeToSpam: () => {}
  }
}`,...n.parameters?.docs?.source},description:{story:"Large counts stay on one line; the figure is tabular so it does not jitter.",...n.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    count: {
      kind: "unknown"
    },
    onScopeToSpam: () => {}
  }
}`,...r.parameters?.docs?.source},description:{story:`No count came back — a junk folder's count request is still in flight, or the
criteria carry a term the server does not count. The offer stands and names
no figure, rather than substituting the junk rows this page happens to hold
(#313).`,...r.parameters?.docs?.description}}};const f=["Default","SingleResult","ManyResults","UncountedResults"];export{e as Default,n as ManyResults,o as SingleResult,r as UncountedResults,f as __namedExportsOrder,h as default};
