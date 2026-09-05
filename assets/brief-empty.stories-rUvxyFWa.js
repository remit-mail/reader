import{j as r}from"./iframe-uufGNBEn.js";import{B as a}from"./brief-empty-BZQy_ju2.js";import"./preload-helper-PPVm8Dsz.js";import"./loader-circle-qkSTSuP1.js";import"./createLucideIcon-Bn-Stmx4.js";import"./sparkles-CHnxu8zM.js";const c=o=>r.jsx("div",{className:"h-screen w-full bg-surface",children:r.jsx("div",{className:"mx-auto h-full max-w-md border-x border-line",children:r.jsx(o,{})})}),g={title:"Screens/Kit/BriefEmpty",component:a,parameters:{layout:"fullscreen"},decorators:[c]},e={args:{}},s={args:{sync:{synced:812,total:4210}}},t={args:{sync:{synced:0,total:0}}},n={globals:{viewport:{value:"mobile"}},args:{sync:{synced:1204,total:18960}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {}
}`,...e.parameters?.docs?.source},description:{story:`Nothing needs attention, and the app has everything it is going to get.
The only state allowed to make that claim.`,...e.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    sync: {
      synced: 812,
      total: 4210
    }
  }
}`,...s.parameters?.docs?.source},description:{story:`The first sync is still running (#452). The list is empty because the mail
has not arrived yet, so the brief says that instead of congratulating the
user on an inbox it has never seen.`,...s.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    sync: {
      synced: 0,
      total: 0
    }
  }
}`,...t.parameters?.docs?.source},description:{story:`The first seconds of a sync: the server has not counted the mailbox yet, so
there is no fraction to show. The state still reads as in-progress rather
than falling back to "caught up".`,...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  args: {
    sync: {
      synced: 1204,
      total: 18960
    }
  }
}`,...n.parameters?.docs?.source},description:{story:"Phone width (411 px) — the copy is the whole state, so it must not clip.",...n.parameters?.docs?.description}}};const u=["CaughtUp","Syncing","SyncingCountUnknown","SyncingPhone"];export{e as CaughtUp,s as Syncing,t as SyncingCountUnknown,n as SyncingPhone,u as __namedExportsOrder,g as default};
