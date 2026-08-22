import{j as e}from"./iframe-BxLfZl0d.js";import{B as d}from"./banner-DLDN0WMz.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-y3nctzTP.js";import"./x-BYZsfpI2.js";import"./createLucideIcon-DDkWk8mg.js";const v={title:"Auth/Banner",component:d,parameters:{layout:"padded"}},r={args:{tone:"info",children:"A new version is available."},parameters:{theme:"dark"}},n={args:{tone:"success",children:"Your changes were saved."},parameters:{theme:"dark"}},s={args:{tone:"warning",children:e.jsxs(e.Fragment,{children:[e.jsx("strong",{className:"font-semibold",children:"Local dev"})," — Cognito not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID in .env.local to enable sign-in."]})},parameters:{theme:"dark"}},a={args:{tone:"danger",children:"Something went wrong."},parameters:{theme:"dark"}},o={args:{tone:"info",children:"Dismiss me.",onDismiss:()=>{}},parameters:{theme:"dark"}},t={args:{tone:"warning",children:e.jsxs(e.Fragment,{children:[e.jsx("strong",{className:"font-semibold",children:"Local dev"})," — Cognito not configured."]})},parameters:{theme:"light"}},i={name:"Soft — OAuth success",args:{tone:"success",variant:"soft",children:"Account connected successfully.",onDismiss:()=>{}}},c={name:"Soft — OAuth error",args:{tone:"danger",variant:"soft",children:"Your organisation's admin needs to approve Remit. Ask your IT admin to grant the required permissions.",onDismiss:()=>{}}},m={name:"Soft — neutral",args:{tone:"info",variant:"soft",children:"Preferences are stored locally."}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "info",
    children: "A new version is available."
  },
  parameters: {
    theme: "dark"
  }
}`,...r.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "success",
    children: "Your changes were saved."
  },
  parameters: {
    theme: "dark"
  }
}`,...n.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "warning",
    children: <>
                <strong className="font-semibold">Local dev</strong> — Cognito not
                configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID in
                .env.local to enable sign-in.
            </>
  },
  parameters: {
    theme: "dark"
  }
}`,...s.parameters?.docs?.source}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "danger",
    children: "Something went wrong."
  },
  parameters: {
    theme: "dark"
  }
}`,...a.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "info",
    children: "Dismiss me.",
    onDismiss: () => undefined
  },
  parameters: {
    theme: "dark"
  }
}`,...o.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    tone: "warning",
    children: <>
                <strong className="font-semibold">Local dev</strong> — Cognito not
                configured.
            </>
  },
  parameters: {
    theme: "light"
  }
}`,...t.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  name: "Soft — OAuth success",
  args: {
    tone: "success",
    variant: "soft",
    children: "Account connected successfully.",
    onDismiss: () => undefined
  }
}`,...i.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  name: "Soft — OAuth error",
  args: {
    tone: "danger",
    variant: "soft",
    children: "Your organisation's admin needs to approve Remit. Ask your IT admin to grant the required permissions.",
    onDismiss: () => undefined
  }
}`,...c.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "Soft — neutral",
  args: {
    tone: "info",
    variant: "soft",
    children: "Preferences are stored locally."
  }
}`,...m.parameters?.docs?.source}}};const O=["Info","Success","Warning","Danger","Dismissible","WarningLight","SoftOauthSuccess","SoftOauthError","SoftNeutral"];export{a as Danger,o as Dismissible,r as Info,m as SoftNeutral,c as SoftOauthError,i as SoftOauthSuccess,n as Success,s as Warning,t as WarningLight,O as __namedExportsOrder,v as default};
