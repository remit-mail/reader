import{j as s}from"./iframe-BxLfZl0d.js";import{P as n}from"./pull-to-refresh-y5WIZJbr.js";import"./preload-helper-PPVm8Dsz.js";import"./use-match-media-PQnav3Jn.js";const i=Array.from({length:20},(e,a)=>`Message ${a+1}`);function d(){return s.jsx("ul",{className:"divide-y divide-line bg-surface",children:i.map(e=>s.jsx("li",{className:"px-4 py-3 text-sm text-fg",children:e},e))})}function l({children:e}){return s.jsx("div",{className:"h-[480px] max-w-md overflow-y-auto rounded-lg border border-line",children:e})}const h={title:"Primitives/PullToRefresh",component:n,parameters:{layout:"padded"},render:e=>s.jsx(l,{children:s.jsx(n,{...e,children:s.jsx(d,{})})})},r={name:"Idle — pull to refresh",args:{onRefresh:()=>new Promise(e=>setTimeout(e,1200))}},o={name:"Refreshing — gesture suspended",args:{onRefresh:()=>Promise.resolve(),isRefreshing:!0}},t={name:"Desktop — gesture inert",parameters:{docs:{description:{story:"At desktop widths (lg, 1024px and up) the gesture is inert and the list renders directly — there is no touch list to pull."}}},globals:{viewport:{value:"desktop"}},args:{onRefresh:()=>Promise.resolve()}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  name: "Idle — pull to refresh",
  args: {
    onRefresh: () => new Promise(resolve => setTimeout(resolve, 1200))
  }
}`,...r.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  name: "Refreshing — gesture suspended",
  args: {
    onRefresh: () => Promise.resolve(),
    isRefreshing: true
  }
}`,...o.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  name: "Desktop — gesture inert",
  parameters: {
    docs: {
      description: {
        story: "At desktop widths (lg, 1024px and up) the gesture is inert and the list renders directly — there is no touch list to pull."
      }
    }
  },
  globals: {
    viewport: {
      value: "desktop"
    }
  },
  args: {
    onRefresh: () => Promise.resolve()
  }
}`,...t.parameters?.docs?.source}}};const g=["Idle","Refreshing","DesktopNoop"];export{t as DesktopNoop,r as Idle,o as Refreshing,g as __namedExportsOrder,h as default};
