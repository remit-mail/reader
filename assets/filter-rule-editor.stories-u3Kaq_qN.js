import{j as r,r as oe}from"./iframe-uufGNBEn.js";import{d as c,a as n,b as Le,C as me,c as ke,W as ue,e as Te,f as ne,g as w,h as pe,i as je}from"./filter-clause-chip-C7573bSY.js";import{F as we,a as g}from"./filter-rule-editor-Cop7DSI_.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./suggest-list-CAdYmTbd.js";import"./button-Wi0n0Lyz.js";import"./input-Cs8KaoXd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./createLucideIcon-Bn-Stmx4.js";import"./x-CuwWA0oJ.js";import"./sparkles-CHnxu8zM.js";import"./plus-ZS84sF7u.js";import"./folder-tree-ZE9Jqoy_.js";import"./loader-circle-qkSTSuP1.js";import"./triangle-alert-BMnL-Txz.js";import"./folder-tree-picker-DOwT19mg.js";import"./folder-row-DSUXG5tk.js";import"./chevron-right-B0dowht5.js";import"./check-BSgP79ub.js";import"./folder-C4FA7sra.js";import"./new-folder-action-7vwcC7A5.js";import"./new-folder-form-5lRSXSZZ.js";import"./field-label-Bp6oPTgY.js";import"./search-DT0jdmVi.js";import"./label-chip-ua_lHL4v.js";import"./segmented-control-Cjrb0mMe.js";const pr={title:"FilterRuleEditor",component:we,parameters:{layout:"padded"},decorators:[e=>r.jsx("div",{className:"mx-auto max-w-md rounded-xl border border-line bg-surface",children:r.jsx(e,{})})]},l=(e,a)=>({status:"ready",count:e,stale:a});function s({initialRule:e,semanticAvailable:a=!0,initialMatchMode:i,propertyRule:u,labels:h=ne,initialClauseEdit:le,folders:ye=c,delimiter:Ce,onCreateFolder:Re,onCreateLabel:Fe}){const[b,d]=oe.useState(e),[Se,Ee]=oe.useState(i),[te,f]=oe.useState(le),xe=oe.useMemo(()=>l(b.clauses.length*23+(b.widen?40:0)),[b]),Ae={onStartAddClause:()=>f({mode:"add",draft:{field:"From",value:""}}),onStartEditClause:o=>{const t=b.clauses.find(m=>m.id===o);t&&f({mode:"edit",clauseId:o,draft:{field:t.field,value:t.value}})},onRemoveClause:o=>{d(t=>({...t,clauses:t.clauses.filter(m=>m.id!==o)}))},onChangeDraftField:o=>f(t=>t&&{...t,draft:{...t.draft,field:o}}),onChangeDraftValue:o=>f(t=>t&&{...t,draft:{...t.draft,value:o}}),onSubmitClause:()=>{f(o=>{o&&d(t=>{if(o.mode==="add"){const m={id:`c-${Date.now()}`,field:o.draft.field,value:o.draft.value};return{...t,clauses:[...t.clauses,m]}}return{...t,clauses:t.clauses.map(m=>m.id===o.clauseId?{...m,field:o.draft.field,value:o.draft.value}:m)}})})},onCancelClause:()=>f(void 0),onAddWiden:()=>{d(o=>({...o,widen:{anchorCount:2}}))},onRemoveWiden:()=>{d(o=>({...o,widen:void 0}))},onChangeMatchOperator:o=>{d(t=>({...t,matchOperator:o}))},onChangeMatchMode:o=>{Ee(o),d(t=>o==="properties"?{...t,clauses:(u??w).clauses,matchOperator:"any",widen:void 0}:{...t,clauses:e.clauses,matchOperator:e.matchOperator,widen:e.widen??{anchorCount:2}})},onChangeMove:o=>d(t=>({...t,moveMailboxId:o||void 0})),onChangeLabel:o=>d(t=>({...t,labelId:o||void 0})),onChangeScope:o=>d(t=>({...t,scope:o})),onChangeName:o=>d(t=>({...t,name:o})),onChangeUntil:o=>d(t=>({...t,until:o}))};return r.jsx(we,{rule:b,folders:ye,delimiter:Ce,labels:h,preview:xe,semanticAvailable:a,matchMode:Se,clauseEdit:te,clauseSuggestions:te?je(te.draft.field,te.draft.value):void 0,onCreateFolder:Re,onCreateLabel:Fe,onCommit:()=>{},onCancel:()=>{},...Ae})}const y={render:()=>r.jsx(s,{initialRule:n})},C={render:()=>r.jsx(s,{initialRule:{...n,clauses:[]},initialMatchMode:"similar",propertyRule:w})},R={render:()=>r.jsx(s,{initialRule:{...w,clauses:w.clauses.slice(0,1),scope:"once",name:""},initialMatchMode:"properties",propertyRule:w})},F={render:()=>r.jsx(s,{initialRule:pe,initialMatchMode:"properties",propertyRule:pe})},S={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"From",value:""}}})},E={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"FromDomain",value:""}}})},x={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"From",value:"someone@nowhere.test"}}})},A={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"Subject",value:"receipt"}}})},p=()=>new Promise(e=>setTimeout(e,60)),se=(e,a)=>{const i=Array.from(e.querySelectorAll("button")).find(u=>u.textContent?.trim()===a);if(!i)throw new Error(`no button reading "${a}"`);i.click()},de=(e,a)=>{const i=e.querySelector(`[aria-label="${a}"]`);if(!i)throw new Error(`no control labelled "${a}"`);i.click()},Ne=(e,a)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(e,a),e.dispatchEvent(new Event("input",{bubbles:!0}))},ve=(e,a)=>{const u=Array.from(e.querySelectorAll("label")).find(le=>le.textContent?.trim()==="Folder name")?.getAttribute("for"),h=u?e.querySelector(`input[id="${u}"]`):null;if(!h)throw new Error("the folder name field is not on screen");Ne(h,a)},ie=async e=>{se(e,"Choose a folder"),await p()},v=async(e,a)=>{const i=e.querySelector(`[aria-label="Move to ${a}"]`);if(!i)throw new Error(`no control labelled "Move to ${a}"`);i.getAttribute("aria-expanded")!=="true"&&i.click(),await p()};async function ae(e,a,i){await ie(e),i?(await v(e,"Inbox"),await v(e,i),de(e,`New folder inside ${i}`)):de(e,"New folder"),await p(),ve(e,a),await p(),se(e,"Create folder")}let he=0;const ce=(e,a)=>new Promise(i=>{he+=1,setTimeout(()=>i({id:`mbx-new-${he}`,label:e,path:a?`${a}/${e}`:e}),400)}),L={name:"Destination — browse the folder tree",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ce}),play:async({canvasElement:e})=>{await ie(e)}},k={name:"Destination — a nested folder and its same-named sibling",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ce}),play:async({canvasElement:e})=>{await ie(e),await v(e,"Inbox"),await v(e,"Travel")}},De=[{id:"mbx-inbox",label:"Inbox",path:"INBOX"},{id:"mbx-archive",label:"Archive",path:"Archive"},{id:"mbx-work",label:"Work",path:"Work"},{id:"mbx-workshop",label:"Workshop",path:"Workshop"}],T={name:"Destination — a flat namespace (server reports no delimiter)",render:()=>r.jsx(s,{initialRule:{...n,moveMailboxId:"mbx-work"},folders:De,delimiter:""})},j={name:"New folder — inside the folder you opened",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ce}),play:async({canvasElement:e})=>{await ie(e),await v(e,"Inbox"),await v(e,"Travel"),de(e,"New folder inside Travel"),await p(),ve(e,"Car hire")}},be="The folder was created but the mail server hasn't confirmed it yet, so nothing was attached to it. It's in your folder list — try again in a moment.",Me=()=>new Promise(()=>{}),ge=e=>()=>Promise.reject(new Error(e)),Pe=()=>{let e=0;return(a,i)=>(e+=1,e===1?Promise.reject(new Error(be)):Promise.resolve({id:"mbx-created",label:a,path:i?`${i}/${a}`:a}))},Ie=(e,a,i)=>new Promise((u,h)=>{i?.addEventListener("abort",()=>h(new DOMException("Aborted","AbortError")))}),N={name:"New folder — creating (waiting for the server)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:Me}),play:async({canvasElement:e})=>{await ae(e,"Receipts")}},D={name:"New folder — create failed (retry / cancel)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ge("The folder couldn't be created on the mail server. Please try again.")}),play:async({canvasElement:e})=>{await ae(e,"Receipts")}},M={name:"New folder — create timed out (retry / cancel)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ge(be)}),play:async({canvasElement:e})=>{await ae(e,"Receipts")}},P={name:"New folder — retry resumes and succeeds",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:Pe()}),play:async({canvasElement:e})=>{await ae(e,"Receipts","Travel"),await p(),se(e,"Create folder")}},I={name:"New folder — cancel aborts the wait",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:Ie}),play:async({canvasElement:e})=>{await ae(e,"Receipts"),await p(),se(e,"Cancel")}},O={render:()=>r.jsx(s,{initialRule:n,labels:[]})},W={render:()=>r.jsx(s,{initialRule:{...n,labelId:"lbl-receipts"}})},$={render:()=>r.jsx(s,{initialRule:n,labels:Array.from({length:20},(e,a)=>({id:`lbl-${a}`,name:`Label ${a+1}`,color:ne[a%ne.length].color}))})},Y={render:()=>r.jsx(s,{initialRule:{...n,labelId:"lbl-long"},labels:[{id:"lbl-long",name:"Quarterly compliance filings that need a second look",color:"Purple"},...ne]})};let fe=0;const Oe=e=>new Promise(a=>{fe+=1,setTimeout(()=>a({id:`lbl-new-${fe}`,name:e,color:"Default"}),400)}),V={render:()=>r.jsx(s,{initialRule:n,onCreateLabel:Oe})},We=()=>new Promise((e,a)=>{setTimeout(()=>a(new Error("That name is already taken.")),400)}),_={render:()=>r.jsx(s,{initialRule:n,onCreateLabel:We})},q={render:()=>r.jsx(s,{initialRule:Le})},U={args:{rule:{clauses:[{id:"c1",field:"Subject",value:"receipt"}],matchOperator:"all",moveMailboxId:"mbx-receipts",scope:"once"},folders:c,preview:l(12)}},B={args:{rule:n,folders:c,preview:l(47),semanticAvailable:!0}},G={args:{rule:{...n,scope:"until",until:"2026-09-01",name:"Conference"},folders:c,preview:l(31),semanticAvailable:!0}},H={render:()=>r.jsx(s,{initialRule:w,semanticAvailable:!1})},Q={args:{rule:{...n,widen:void 0},folders:c,preview:l(24),semanticAvailable:!1}},z={args:{rule:{...n,widen:{anchorCount:2,inactive:!0}},folders:c,preview:l(19),semanticAvailable:!1}},J={args:{rule:{...n,scope:"until",until:"2027-09-01",name:"Conference"},folders:c,preview:l(31),semanticAvailable:!1,anchorLocked:!0}},X={args:{rule:{clauses:[],matchOperator:"all",scope:"once"},folders:c,preview:l(0),semanticAvailable:!0}},K={args:{rule:n,folders:c,preview:{status:"loading"},semanticAvailable:!0}},Z={args:{rule:n,folders:c,preview:l(47,!0),semanticAvailable:!0}},ee={args:{rule:n,folders:c,preview:{status:"error",reason:"Couldn't reach the server to count."},semanticAvailable:!0}},re={render:()=>{const e=["From","Subject","HasWords","ListId","FromDomain"];return r.jsxs("div",{className:"space-y-4 p-4",children:[r.jsx("div",{className:"flex flex-wrap gap-2",children:e.map(a=>r.jsx(me,{clause:{id:a,field:a,value:ke(a)},onEdit:()=>{},onRemove:()=>{}},a))}),r.jsxs("div",{className:"flex flex-wrap gap-2",children:[r.jsx(me,{clause:{id:"d",field:"From",value:"receipts@stripe.com",derived:!0},onEdit:()=>{},onRemove:()=>{}}),r.jsx(ue,{widen:{anchorCount:2},onRemove:()=>{}}),r.jsx(ue,{widen:{anchorCount:2,inactive:!0}})]}),r.jsx(Te,{draft:{field:"ListId",value:"python-dev.python.org"},mode:"edit",onChangeField:()=>{},onChangeValue:()=>{},onSubmit:()=>{},onCancel:()=>{}}),r.jsxs("div",{className:"space-y-2",children:[r.jsx(g,{preview:{status:"loading"}}),r.jsx(g,{preview:l(0)}),r.jsx(g,{preview:l(412)}),r.jsx(g,{preview:l(47,!0)}),r.jsx(g,{preview:{status:"error",reason:"Couldn't count."}})]})]})}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} />
}`,...y.parameters?.docs?.source},description:{story:"The full editor, interactive — the shape ticket B and the app consume.",...y.parameters?.docs?.description}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    clauses: []
  }} initialMatchMode="similar" propertyRule={demoSenderFallbackRule} />
}`,...C.parameters?.docs?.source},description:{story:`The Organize surface, where the rule can be matched either way. It opens on
"Anything similar" — semantic is still the default — and switching to
"Its properties" drops the widen for the clauses derived from the messages
that were selected. Switch back and the widen returns.`,...C.parameters?.docs?.description}}};R.parameters={...R.parameters,docs:{...R.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoSenderFallbackRule,
    clauses: demoSenderFallbackRule.clauses.slice(0, 1),
    scope: "once",
    name: ""
  }} initialMatchMode="properties" propertyRule={demoSenderFallbackRule} />
}`,...R.parameters?.docs?.source},description:{story:"Properties matching with one sender behind the whole selection — a single\n`From` chip, no semantics involved. Editable like any other chip.",...R.parameters?.docs?.description}}};F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoSubjectPrefillRule} initialMatchMode="properties" propertyRule={demoSubjectPrefillRule} />
}`,...F.parameters?.docs?.source},description:{story:`Properties matching when the senders differ: the prefill falls back to the
part the selected subjects share, so the rule still starts somewhere useful.`,...F.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    widen: undefined
  }} semanticAvailable={false} initialClauseEdit={{
    mode: "add",
    draft: {
      field: "From",
      value: ""
    }
  }} />
}`,...S.parameters?.docs?.source},description:{story:`Adding a \`From\` clause, with the value field offering what it knows: the
senders of the messages that were selected lead the list — marked "selected",
and there before a key is pressed — followed by other known addresses. Typing
narrows it; anything typed still stands, match or no match.`,...S.parameters?.docs?.description}}};E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    widen: undefined
  }} semanticAvailable={false} initialClauseEdit={{
    mode: "add",
    draft: {
      field: "FromDomain",
      value: ""
    }
  }} />
}`,...E.parameters?.docs?.source},description:{story:"The same field on a `Domain` clause: the addresses collapse to registrable\ndomains, so the value offered is exactly the string the matcher compares.",...E.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    widen: undefined
  }} semanticAvailable={false} initialClauseEdit={{
    mode: "add",
    draft: {
      field: "From",
      value: "someone@nowhere.test"
    }
  }} />
}`,...x.parameters?.docs?.source},description:{story:`Typing something no known sender matches. The list simply goes away — no
empty panel, no warning, no block on the value. A clause for an address that
has not written yet is a legitimate rule.`,...x.parameters?.docs?.description}}};A.parameters={...A.parameters,docs:{...A.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    widen: undefined
  }} semanticAvailable={false} initialClauseEdit={{
    mode: "add",
    draft: {
      field: "Subject",
      value: "receipt"
    }
  }} />
}`,...A.parameters?.docs?.source},description:{story:"A free-text field is left alone: `Subject` has nothing to draw suggestions\nfrom, so it stays the plain box it was.",...A.parameters?.docs?.description}}};L.parameters={...L.parameters,docs:{...L.parameters?.docs,source:{originalSource:`{
  name: "Destination — browse the folder tree",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await openDestinationTree(canvasElement);
  }
}`,...L.parameters?.docs?.source},description:{story:`The destination is chosen from the same browsable tree every other picker
uses: open a folder to see what is inside it, filter to narrow, and make a
new one where you are looking.`,...L.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "Destination — a nested folder and its same-named sibling",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await openDestinationTree(canvasElement);
    await openFolder(canvasElement, "Inbox");
    await openFolder(canvasElement, "Travel");
  }
}`,...k.parameters?.docs?.source},description:{story:`Two folders named Receipts, one at the top level and one inside Travel. The
tree tells them apart by where they sit; a list of leaf names could not.`,...k.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "Destination — a flat namespace (server reports no delimiter)",
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    moveMailboxId: "mbx-work"
  }} folders={flatFolders} delimiter="" />
}`,...T.parameters?.docs?.source},description:{story:"A flat namespace, where the chosen destination reads as its whole path —\n`Work`, not one segment per character.",...T.parameters?.docs?.description}}};j.parameters={...j.parameters,docs:{...j.parameters?.docs,source:{originalSource:`{
  name: "New folder — inside the folder you opened",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await openDestinationTree(canvasElement);
    await openFolder(canvasElement, "Inbox");
    await openFolder(canvasElement, "Travel");
    clickAriaLabel(canvasElement, "New folder inside Travel");
    await tick();
    typeFolderName(canvasElement, "Car hire");
  }
}`,...j.parameters?.docs?.source},description:{story:"A new folder is made inside the folder the tree is looking at, so a filter can\npoint at `Travel/Car hire` without leaving the editor.",...j.parameters?.docs?.description}}};N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
  name: "New folder — creating (waiting for the server)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={neverResolvesCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...N.parameters?.docs?.source},description:{story:`The folder is a dependent write for the filter, so creating it waits for the
mail server to confirm the folder before it can be picked as the destination.
The wait is held in the form, which refuses a second submit while it runs.`,...N.parameters?.docs?.description}}};D.parameters={...D.parameters,docs:{...D.parameters?.docs,source:{originalSource:`{
  name: "New folder — create failed (retry / cancel)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={rejectingCreateFolder("The folder couldn't be created on the mail server. Please try again.")} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...D.parameters?.docs?.source},description:{story:`The folder create failed on the mail server. The rule is not committed against
a folder that does not exist: the error is surfaced inline with the create form
still open, so the create can be retried or cancelled.`,...D.parameters?.docs?.description}}};M.parameters={...M.parameters,docs:{...M.parameters?.docs,source:{originalSource:`{
  name: "New folder — create timed out (retry / cancel)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={rejectingCreateFolder(TIMEOUT_MESSAGE)} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...M.parameters?.docs?.source},description:{story:`The folder create was never confirmed within the wait bound. Distinct from a
hard failure — the message names the timeout — and, like a failure, leaves no
folder selected, so no filter is written against it.`,...M.parameters?.docs?.description}}};P.parameters={...P.parameters,docs:{...P.parameters?.docs,source:{originalSource:`{
  name: "New folder — retry resumes and succeeds",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={failThenSucceedCreateFolder()} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts", "Travel");
    await tick();
    clickText(canvasElement, "Create folder");
  }
}`,...P.parameters?.docs?.source},description:{story:`Retry is a resume: the first attempt times out (the folder was made but not yet
confirmed), and pressing "Create folder" again with the same name resolves —
the hook re-waits on the folder it already made rather than re-creating it, so
the retry the failure message points at actually works.`,...P.parameters?.docs?.description}}};I.parameters={...I.parameters,docs:{...I.parameters?.docs,source:{originalSource:`{
  name: "New folder — cancel aborts the wait",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={abortAwareCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
    await tick();
    clickText(canvasElement, "Cancel");
  }
}`,...I.parameters?.docs?.source},description:{story:`Cancelling while the create is in flight aborts the wait: the create promise
rejects with an AbortError the form swallows, so no destination binds after
the user backed out — the form just closes.`,...I.parameters?.docs?.description}}};O.parameters={...O.parameters,docs:{...O.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} labels={[]} />
}`,...O.parameters?.docs?.source},description:{story:'No labels exist yet in the account — the select offers only "No label".',...O.parameters?.docs?.description}}};W.parameters={...W.parameters,docs:{...W.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    labelId: "lbl-receipts"
  }} />
}`,...W.parameters?.docs?.source},description:{story:"A rule that already applies a label — the chip renders next to the select.",...W.parameters?.docs?.description}}};$.parameters={...$.parameters,docs:{...$.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} labels={Array.from({
    length: 20
  }, (_, i) => ({
    id: \`lbl-\${i}\`,
    name: \`Label \${i + 1}\`,
    color: demoLabels[i % demoLabels.length].color
  }))} />
}`,...$.parameters?.docs?.source},description:{story:"Many labels in the account — the select scrolls rather than the layout growing.",...$.parameters?.docs?.description}}};Y.parameters={...Y.parameters,docs:{...Y.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    labelId: "lbl-long"
  }} labels={[{
    id: "lbl-long",
    name: "Quarterly compliance filings that need a second look",
    color: "Purple"
  }, ...demoLabels]} />
}`,...Y.parameters?.docs?.source},description:{story:"A long label name truncates in the chip rather than overflowing the row.",...Y.parameters?.docs?.description}}};V.parameters={...V.parameters,docs:{...V.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabel} />
}`,...V.parameters?.docs?.source},description:{story:`The label select offers a "＋ New label…" option because \`onCreateLabel\` is
wired (issue #26). Choosing it reveals a name field; on resolve the label is
added to the select and picked as the action. Without the prop the option
never shows — the editor stays data-agnostic.`,...V.parameters?.docs?.description}}};_.parameters={..._.parameters,docs:{..._.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabelFailure} />
}`,..._.parameters?.docs?.source},description:{story:"Creating a label from the picker can fail — the field stays open with the reason.",..._.parameters?.docs?.description}}};q.parameters={...q.parameters,docs:{...q.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoVocabularyRule} />
}`,...q.parameters?.docs?.source},description:{story:'Literal clauses joined with "or", including the ticket-B ListId and FromDomain fields.',...q.parameters?.docs?.description}}};U.parameters={...U.parameters,docs:{...U.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      clauses: [{
        id: "c1",
        field: "Subject",
        value: "receipt"
      }],
      matchOperator: "all",
      moveMailboxId: "mbx-receipts",
      scope: "once"
    },
    folders: demoFolders,
    preview: READY(12)
  }
}`,...U.parameters?.docs?.source},description:{story:'A one-time rule — no name, no widen, the commit reads "Apply now".',...U.parameters?.docs?.description}}};B.parameters={...B.parameters,docs:{...B.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: READY(47),
    semanticAvailable: true
  }
}`,...B.parameters?.docs?.source},description:{story:'Standing scope with a widen — the "keep doing this" rule.',...B.parameters?.docs?.description}}};G.parameters={...G.parameters,docs:{...G.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      ...demoRule,
      scope: "until",
      until: "2026-09-01",
      name: "Conference"
    },
    folders: demoFolders,
    preview: READY(31),
    semanticAvailable: true
  }
}`,...G.parameters?.docs?.source},description:{story:"Timed scope — the name and a date the rule stops on.",...G.parameters?.docs?.description}}};H.parameters={...H.parameters,docs:{...H.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoSenderFallbackRule} semanticAvailable={false} />
}`,...H.parameters?.docs?.source},description:{story:`The sender-fallback (#251) as chips: the derived From clauses are ordinary
visible, editable chips, not an invisible substitution.`,...H.parameters?.docs?.description}}};Q.parameters={...Q.parameters,docs:{...Q.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      ...demoRule,
      widen: undefined
    },
    folders: demoFolders,
    preview: READY(24),
    semanticAvailable: false
  }
}`,...Q.parameters?.docs?.source},description:{story:`The deployment cannot serve the widen (RFC 038 D4): the "…and similar" add is
not offered and the rule matches by its literal clauses only.`,...Q.parameters?.docs?.description}}};z.parameters={...z.parameters,docs:{...z.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      ...demoRule,
      widen: {
        anchorCount: 2,
        inactive: true
      }
    },
    folders: demoFolders,
    preview: READY(19),
    semanticAvailable: false
  }
}`,...z.parameters?.docs?.source},description:{story:`A standing rule that carries an anchor this deployment cannot evaluate — the
widen chip lists as inactive and nothing claims similarity is running.`,...z.parameters?.docs?.description}}};J.parameters={...J.parameters,docs:{...J.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      ...demoRule,
      scope: "until",
      until: "2027-09-01",
      name: "Conference"
    },
    folders: demoFolders,
    preview: READY(31),
    semanticAvailable: false,
    anchorLocked: true
  }
}`,...J.parameters?.docs?.source},description:{story:`Editing a persisted filter (RFC 038 D6, reader #266): scope and expiry stay
live and editable — a standing filter can move to "until a date" and back,
or its date can change. The semantic anchor is the one thing fixed at
creation: the widen chip renders display-only with a one-line note, and
"Just once" drops out of the scope toggle since no saved filter can hold it.`,...J.parameters?.docs?.description}}};X.parameters={...X.parameters,docs:{...X.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      clauses: [],
      matchOperator: "all",
      scope: "once"
    },
    folders: demoFolders,
    preview: READY(0),
    semanticAvailable: true
  }
}`,...X.parameters?.docs?.source},description:{story:"Nothing to match yet — the commit says why it is blocked.",...X.parameters?.docs?.description}}};K.parameters={...K.parameters,docs:{...K.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: {
      status: "loading"
    },
    semanticAvailable: true
  }
}`,...K.parameters?.docs?.source},description:{story:"The live count while it recomputes — the commit waits for it to settle.",...K.parameters?.docs?.description}}};Z.parameters={...Z.parameters,docs:{...Z.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: READY(47, true),
    semanticAvailable: true
  }
}`,...Z.parameters?.docs?.source},description:{story:`The previewed set changed under the rule — recounting, never blank, and the
"Save rule" button is held disabled until the count that will be applied is
the count on screen (RFC 038's previewed-set-equals-applied-set contract).`,...Z.parameters?.docs?.description}}};ee.parameters={...ee.parameters,docs:{...ee.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: {
      status: "error",
      reason: "Couldn't reach the server to count."
    },
    semanticAvailable: true
  }
}`,...ee.parameters?.docs?.source},description:{story:"The preview failed — the count region raises it, the editor stays usable.",...ee.parameters?.docs?.description}}};re.parameters={...re.parameters,docs:{...re.parameters?.docs,source:{originalSource:`{
  render: () => {
    const fields: ClauseField[] = ["From", "Subject", "HasWords", "ListId", "FromDomain"];
    return <div className="space-y-4 p-4">
                <div className="flex flex-wrap gap-2">
                    {fields.map(field => <ClauseChip key={field} clause={{
          id: field,
          field,
          value: clauseFieldLabel(field)
        }} onEdit={() => {}} onRemove={() => {}} />)}
                </div>
                <div className="flex flex-wrap gap-2">
                    <ClauseChip clause={{
          id: "d",
          field: "From",
          value: "receipts@stripe.com",
          derived: true
        }} onEdit={() => {}} onRemove={() => {}} />
                    <WidenChip widen={{
          anchorCount: 2
        }} onRemove={() => {}} />
                    <WidenChip widen={{
          anchorCount: 2,
          inactive: true
        }} />
                </div>
                <ClauseEditor draft={{
        field: "ListId",
        value: "python-dev.python.org"
      }} mode="edit" onChangeField={() => {}} onChangeValue={() => {}} onSubmit={() => {}} onCancel={() => {}} />
                <div className="space-y-2">
                    <FilterPreviewCount preview={{
          status: "loading"
        }} />
                    <FilterPreviewCount preview={READY(0)} />
                    <FilterPreviewCount preview={READY(412)} />
                    <FilterPreviewCount preview={READY(47, true)} />
                    <FilterPreviewCount preview={{
          status: "error",
          reason: "Couldn't count."
        }} />
                </div>
            </div>;
  }
}`,...re.parameters?.docs?.source},description:{story:"Every clause and widen chip in isolation, including edit and inactive states.",...re.parameters?.docs?.description}}};const hr=["Interactive","MatchModeSemanticDefault","MatchOnSenderProperty","MatchOnSubjectProperty","ClauseValueSuggestions","DomainClauseSuggestions","ClauseValueNoMatches","SubjectClauseStaysFreeText","DestinationTree","DestinationNestedFolders","DestinationFlatNamespace","NewFolderInsideAnother","NewFolderCreating","NewFolderCreateFailed","NewFolderCreateTimedOut","NewFolderCreateRetrySucceeds","NewFolderCreateCancelledMidWait","NoLabels","WithLabelSelected","ManyLabels","LongLabelNames","WithNewLabelOption","LabelCreateError","AnyOfTheseClauses","OneTimeMove","StandingWithWiden","UntilADate","SenderFallbackChips","SemanticUnavailable","DegradedStandingWiden","AnchorLocked","BlockedEmpty","PreviewLoading","PreviewStale","PreviewError","ChipGallery"];export{J as AnchorLocked,q as AnyOfTheseClauses,X as BlockedEmpty,re as ChipGallery,x as ClauseValueNoMatches,S as ClauseValueSuggestions,z as DegradedStandingWiden,T as DestinationFlatNamespace,k as DestinationNestedFolders,L as DestinationTree,E as DomainClauseSuggestions,y as Interactive,_ as LabelCreateError,Y as LongLabelNames,$ as ManyLabels,C as MatchModeSemanticDefault,R as MatchOnSenderProperty,F as MatchOnSubjectProperty,I as NewFolderCreateCancelledMidWait,D as NewFolderCreateFailed,P as NewFolderCreateRetrySucceeds,M as NewFolderCreateTimedOut,N as NewFolderCreating,j as NewFolderInsideAnother,O as NoLabels,U as OneTimeMove,ee as PreviewError,K as PreviewLoading,Z as PreviewStale,Q as SemanticUnavailable,H as SenderFallbackChips,B as StandingWithWiden,A as SubjectClauseStaysFreeText,G as UntilADate,W as WithLabelSelected,V as WithNewLabelOption,hr as __namedExportsOrder,pr as default};
