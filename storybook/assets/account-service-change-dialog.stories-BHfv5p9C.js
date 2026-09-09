import{A as d}from"./account-service-change-dialog-DVg41VQV.js";import"./iframe-R-hq3KXP.js";import"./preload-helper-PPVm8Dsz.js";import"./confirm-dialog-DWj0j5nu.js";import"./cn-d2XQ1MEC.js";import"./overlay-scope-CbgdyXI5.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BNTAB0Hf.js";import"./dialog-backdrop-BIH6Z9bE.js";const{expect:i,within:c}=__STORYBOOK_MODULE_TEST__,f={title:"Components/AccountServiceChangeDialog",component:d,parameters:{layout:"fullscreen",docs:{description:{component:`The question between a service switch and the change it asks for (#1179).
Every state of it is copy, so every state is a story.`}}},args:{providerName:"Microsoft",onConfirm:()=>{},onCancel:()=>{}}},e={args:{change:{kind:"disable",service:"Mail"}},play:async({canvasElement:o})=>{const r=c(o);await i(r.getByText(/Nothing is deleted/)).toBeVisible()}},a={args:{change:{kind:"disable",service:"Calendar"}}},n={args:{change:{kind:"enable",service:"Calendar"}},play:async({canvasElement:o})=>{const r=c(o);await i(r.getByRole("button",{name:"Continue to Microsoft"})).toBeVisible()}},s={args:{change:{kind:"last",service:"Mail"}}},t={args:{change:null}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    change: {
      kind: "disable",
      service: "Mail"
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Nothing is deleted/)).toBeVisible();
  }
}`,...e.parameters?.docs?.source},description:{story:`Mail off. The confirmation is the only place the promise is made, so it makes
it in full: what stays, what stops, and that nothing is deleted.`,...e.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    change: {
      kind: "disable",
      service: "Calendar"
    }
  }
}`,...a.parameters?.docs?.source},description:{story:"Calendar off. The events already read in stay on the calendar.",...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    change: {
      kind: "enable",
      service: "Calendar"
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", {
      name: "Continue to Microsoft"
    })).toBeVisible();
  }
}`,...n.parameters?.docs?.source},description:{story:`Calendar on, for an account whose consent never covered it. The round trip is
named before the person commits, and nothing changes until they are back.`,...n.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    change: {
      kind: "last",
      service: "Mail"
    }
  }
}`,...s.parameters?.docs?.source},description:{story:`The switch that would leave the account syncing nothing. No stored account
holds the empty set, so this points at removing the account and says what
that costs — which is what switching a service off never does.`,...s.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    change: null
  }
}`,...t.parameters?.docs?.source},description:{story:"Nothing pending: the dialog is absent, not an empty overlay.",...t.parameters?.docs?.description}}};const w=["DisableMail","DisableCalendar","EnableCalendar","LastService","NothingPending"];export{a as DisableCalendar,e as DisableMail,n as EnableCalendar,s as LastService,t as NothingPending,w as __namedExportsOrder,f as default};
