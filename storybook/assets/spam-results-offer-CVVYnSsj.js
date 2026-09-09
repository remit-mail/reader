import{j as e}from"./iframe-R-hq3KXP.js";import{B as a}from"./banner-BhQiwCh2.js";import{B as s}from"./button-DALtMcT0.js";const o=t=>t===1?"result":"results";function r({count:t,onScopeToSpam:n}){return e.jsx(a,{tone:"info",variant:"soft",className:"items-center justify-between gap-3 rounded-none border-b border-line",children:e.jsxs("div",{className:"flex items-center justify-between gap-3",children:[e.jsx("p",{className:"min-w-0 text-xs text-fg-muted",children:t.kind==="exact"?e.jsxs(e.Fragment,{children:[e.jsx("span",{className:"font-semibold text-fg tabular-nums",children:t.value.toLocaleString()})," ",`${o(t.value)} from Spam`]}):"Results from Spam"}),e.jsx(s,{variant:"ghost",size:"sm",onClick:n,className:"shrink-0 text-accent",children:"Go to Spam"})]})})}r.__docgenInfo={description:`Spam matches held out of a global search, offered rather than mixed in. Spam
is the one folder a search that reaches everywhere does not inline, because
the whole point of the folder is that its contents are unwanted until asked
for. Taking the offer scopes the search to Spam.

The count is the server's, over every junk folder the search reached; the
action opens one of them. It deliberately does not read "view them", because
scope is a single mailbox and a user with several accounts has several Spam
folders — the count would then name more mail than the click delivers. Saying
where the button goes is true whatever the account setup.

\`unknown\` renders as no number rather than as a substitute for one. The
figure this used to show was the junk share of the page the client had
loaded, offered as a folder total; a match sitting below that page was
missing from it (#313). A count nobody could take is worth less than a wrong
one is harmful, so the offer stands without it and stays honest.

Quiet on purpose: this is an offer, not a warning. Presentational — the
caller owns what "scope to spam" does.`,methods:[],displayName:"SpamResultsOffer",props:{count:{required:!0,tsType:{name:"ResultCount"},description:"How many matches the search found in Spam, as the server counted them —\nsummed over every junk folder the search reached. `unknown` when any one of\nthose folders went uncounted, and the offer then names no figure at all."},onScopeToSpam:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:"Scope the search to Spam. This is a shortcut to the state reached by\nnavigating to Spam with the query carried over — the same scoped search,\nwith the same `in:spam` chip — not a separate result mode."}}};export{r as S};
