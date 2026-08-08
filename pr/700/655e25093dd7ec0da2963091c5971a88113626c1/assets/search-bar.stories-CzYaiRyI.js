import{j as e,r as p}from"./iframe-fAVmrNjG.js";import{S as i}from"./search-bar-BzQj0g0k.js";import"./preload-helper-PPVm8Dsz.js";import"./search-chip-input-9FcfGUJN.js";import"./cn-yMAG7bfM.js";import"./search-token-chip-D1dyw_Bk.js";import"./x-CiqSzl9P.js";import"./createLucideIcon-E7hVbHyY.js";import"./search-BLZaoIk7.js";const h={title:"Mail/SearchBar",component:i,parameters:{layout:"padded"}},o=({initial:c=""})=>{const[m,n]=p.useState(c);return e.jsx("div",{className:"w-80",children:e.jsx(i,{value:m,onChange:n,onClear:()=>n(""),onClearQuery:()=>n(""),globalFocusKey:!1})})},r={render:()=>e.jsx(o,{})},a={render:()=>e.jsx(o,{initial:"invoi"})},t={render:()=>e.jsx(o,{initial:"from:acme receipt"})},s={render:()=>e.jsx(o,{}),play:async({canvasElement:c})=>{c.querySelector('input[aria-label="Search mail"]')?.focus()}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
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
}`,...s.parameters?.docs?.source}}};const j=["Empty","Typing","WithQuery","Focused"];export{r as Empty,s as Focused,a as Typing,t as WithQuery,j as __namedExportsOrder,h as default};
