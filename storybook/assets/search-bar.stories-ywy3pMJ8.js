import{j as e,r as p}from"./iframe-DS5xN_9u.js";import{S as i}from"./search-bar-DWAnGmG_.js";import"./preload-helper-PPVm8Dsz.js";import"./search-chip-input-fDkYxqUt.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-BDkw0-iB.js";import"./keymap-dispatch-DTaqnLKC.js";import"./search-token-chip-DW8jJ9mQ.js";import"./x-BXk_suZj.js";import"./createLucideIcon-C2HcSaX7.js";import"./search-BdDyeiBi.js";const E={title:"Design System/Search/SearchBar",component:i,parameters:{layout:"padded"}},o=({initial:c=""})=>{const[m,n]=p.useState(c);return e.jsx("div",{className:"w-80",children:e.jsx(i,{value:m,onChange:n,onClear:()=>n(""),onClearQuery:()=>n(""),globalFocusKey:!1})})},r={render:()=>e.jsx(o,{})},a={render:()=>e.jsx(o,{initial:"invoi"})},t={render:()=>e.jsx(o,{initial:"from:acme receipt"})},s={render:()=>e.jsx(o,{}),play:async({canvasElement:c})=>{c.querySelector('input[aria-label="Search mail"]')?.focus()}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive />
}`,...r.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initial="invoi" />
}`,...a.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive initial="from:acme receipt" />
}`,...t.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  render: () => <Interactive />,
  play: async ({
    canvasElement
  }) => {
    canvasElement.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')?.focus();
  }
}`,...s.parameters?.docs?.source}}};const I=["Empty","Typing","WithQuery","Focused"];export{r as Empty,s as Focused,a as Typing,t as WithQuery,I as __namedExportsOrder,E as default};
