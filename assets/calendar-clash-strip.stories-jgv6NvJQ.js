import{j as t}from"./iframe-uufGNBEn.js";import{C as c}from"./calendar-clash-strip-D9om_lyL.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./check-BSgP79ub.js";import"./createLucideIcon-Bn-Stmx4.js";import"./triangle-alert-BMnL-Txz.js";const y={title:"Calendar/Clash strip",component:c,parameters:{layout:"padded",docs:{description:{component:`The cost of saying yes, drawn before the answer. The clear case is drawn too:
an empty space where the check should be reads as "not checked".`}}},decorators:[n=>t.jsx("div",{className:"max-w-sm",children:t.jsx(n,{})})]},o={id:"evt_dentist",label:"Dentist · 14:30 – 15:15 · Personal (matthijs@)"},i={id:"evt_standup",label:"Sprint planning · 14:00 – 15:00 · Work (work@)"},e={args:{clashes:[]}},s={args:{clashes:[o]}},r={args:{clashes:[o,i]}},a={args:{clashes:[],clearText:"Thursday afternoon is empty from 15:15."}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    clashes: []
  }
}`,...e.parameters?.docs?.source},description:{story:"Nothing booked, said out loud.",...e.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    clashes: [dentist]
  }
}`,...s.parameters?.docs?.source},description:{story:"One collision, named with the calendar and the account it came from.",...s.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    clashes: [dentist, standup]
  }
}`,...r.parameters?.docs?.source},description:{story:"Several, counted in the sentence so the tally is not left to the eye.",...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    clashes: [],
    clearText: "Thursday afternoon is empty from 15:15."
  }
}`,...a.parameters?.docs?.source},description:{story:"The caller knows which span was checked, so it words the clear case.",...a.parameters?.docs?.description}}};const w=["Clear","OneClash","SeveralClashes","ClearWithItsOwnWords"];export{e as Clear,a as ClearWithItsOwnWords,s as OneClash,r as SeveralClashes,w as __namedExportsOrder,y as default};
