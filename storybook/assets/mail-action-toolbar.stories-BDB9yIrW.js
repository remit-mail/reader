import{j as t}from"./iframe-DS5xN_9u.js";import{M as i}from"./mail-action-toolbar-bob1SHJK.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./button-D5VdN6KM.js";import"./reply-Bw2o1tN_.js";import"./createLucideIcon-C2HcSaX7.js";import"./trash-2-DgSzqfOe.js";import"./folder-input-Cqev66qG.js";import"./star-CgqUZgOe.js";const S={title:"Design System/Mail/MailActionToolbar",component:i,parameters:{layout:"centered"},decorators:[(n=>t.jsx("div",{className:"overflow-hidden rounded-lg border border-line",style:{width:720},children:t.jsx(n,{})}))],args:{hasThread:!0,onReply:()=>{},onReplyAll:()=>{},onForward:()=>{},onDelete:()=>{},onMove:()=>{},onToggleStar:()=>{},onUnavailable:()=>{}}},e={args:{isStarred:!1}},r={args:{isStarred:!0}},s={args:{isStarred:void 0}},a={args:{showTriage:!1}},o={args:{hasThread:!1,unavailableHint:"Open a message first"}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    isStarred: false
  }
}`,...e.parameters?.docs?.source},description:{story:"The conversation has answered and the open message is not starred.",...e.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    isStarred: true
  }
}`,...r.parameters?.docs?.source},description:{story:`The open message is starred: the star is lit and reads as pressed. It
 follows the conversation, not the list row that opened it (#602).`,...r.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    isStarred: undefined
  }
}`,...s.parameters?.docs?.source},description:{story:'The conversation has not answered yet, so the star state is unknown. The\n button omits `aria-pressed` rather than announcing "not pressed" for a\n message that may well be starred.',...s.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    showTriage: false
  }
}`,...a.parameters?.docs?.source},description:{story:`The mobile pane's management bar already owns triage, so the toolbar drops
 the cluster instead of offering a second set of the same accessible names.`,...a.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    hasThread: false,
    unavailableHint: "Open a message first"
  }
}`,...o.parameters?.docs?.source},description:{story:`No message open: the verbs no-op and the bar surfaces a one-line reason
 instead of disabling.`,...o.parameters?.docs?.description}}};const b=["Default","Starred","StarUnknown","WithoutTriage","NoMessageOpen"];export{e as Default,o as NoMessageOpen,s as StarUnknown,r as Starred,a as WithoutTriage,b as __namedExportsOrder,S as default};
