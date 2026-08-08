import{j as e}from"./iframe-fAVmrNjG.js";import{A as a}from"./auth-card-IFe2RYPJ.js";import{A as d}from"./auth-footer-DdxapFOr.js";import{A as t}from"./auth-hero-DymMUaqi.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";const h={title:"Auth/AuthCard",component:a,parameters:{layout:"fullscreen"}},o=()=>e.jsxs("div",{className:"rounded-md border border-line bg-surface p-7 shadow-lg",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"space-y-1.5",children:[e.jsx("span",{className:"block text-sm font-medium text-fg",children:"Email"}),e.jsx("div",{className:"h-9 rounded-md border border-line bg-surface"})]}),e.jsxs("div",{className:"space-y-1.5",children:[e.jsx("span",{className:"block text-sm font-medium text-fg",children:"Password"}),e.jsx("div",{className:"h-9 rounded-md border border-line bg-surface"})]}),e.jsx("div",{className:"h-9 rounded-md bg-accent"})]}),e.jsx(d,{})]}),r={parameters:{theme:"dark"},render:()=>e.jsxs(a,{children:[e.jsx(t,{}),e.jsx(o,{})]})},s={parameters:{theme:"light"},render:()=>e.jsxs(a,{children:[e.jsx(t,{}),e.jsx(o,{})]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  parameters: {
    theme: "dark"
  },
  render: () => <AuthCard>
            <AuthHero />
            <SampleForm />
        </AuthCard>
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  parameters: {
    theme: "light"
  },
  render: () => <AuthCard>
            <AuthHero />
            <SampleForm />
        </AuthCard>
}`,...s.parameters?.docs?.source}}};const u=["Dark","Light"];export{r as Dark,s as Light,u as __namedExportsOrder,h as default};
