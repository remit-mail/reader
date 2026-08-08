import{j as e}from"./iframe-uTafckjr.js";import{B as s}from"./banner-Hh0xdm4p.js";import{B as n}from"./button-DCXIHjmE.js";const r=t=>t===1?"result":"results";function o({count:t,onScopeToSpam:a}){return e.jsx(s,{tone:"info",variant:"soft",className:"items-center justify-between gap-3 rounded-none border-b border-line",children:e.jsxs("div",{className:"flex items-center justify-between gap-3",children:[e.jsxs("p",{className:"min-w-0 text-xs text-fg-muted",children:[e.jsx("span",{className:"font-semibold text-fg tabular-nums",children:t})," ",`${r(t)} from Spam`]}),e.jsx(n,{variant:"ghost",size:"sm",onClick:a,className:"shrink-0 text-accent",children:"Go to Spam"})]})})}o.__docgenInfo={description:`Spam matches held out of a global search, offered rather than mixed in. Spam
is the one folder a search that reaches everywhere does not inline, because
the whole point of the folder is that its contents are unwanted until asked
for. Taking the offer scopes the search to Spam.

The count is every match held out; the action opens Spam. It deliberately
does not read "view them", because scope is a single mailbox and a user with
several accounts has several Spam folders — the count would then name more
mail than the click delivers. Saying where the button goes is true whatever
the account setup.

Quiet on purpose: this is an offer, not a warning. Presentational — the
caller owns what "scope to spam" does.`,methods:[],displayName:"SpamResultsOffer",props:{count:{required:!0,tsType:{name:"number"},description:"How many matches the search found in Spam."},onScopeToSpam:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:"Scope the search to Spam. This is a shortcut to the state reached by\nnavigating to Spam with the query carried over — the same scoped search,\nwith the same `in:spam` chip — not a separate result mode."}}};export{o as S};
