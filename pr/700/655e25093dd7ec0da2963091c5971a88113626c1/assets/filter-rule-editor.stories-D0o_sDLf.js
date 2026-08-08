import{j as r,r as te}from"./iframe-fAVmrNjG.js";import{d as c,a as n,b as Ee,C as ce,c as xe,W as me,e as Ae,f as oe,g as w,h as ue,i as Le}from"./filter-clause-chip-CtkoCxYk.js";import{F as fe,a as g}from"./filter-rule-editor-Cz-NVfl_.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./suggest-list-Bwt5AfBt.js";import"./button-C4vqyepI.js";import"./input-f1p4CyT9.js";import"./select-CEf-HAQa.js";import"./chevron-down-CV-Txd5h.js";import"./createLucideIcon-E7hVbHyY.js";import"./x-CiqSzl9P.js";import"./sparkles-DroEPvOz.js";import"./loader-circle-tGqNKIei.js";import"./triangle-alert-Bel_inG1.js";import"./folder-tree-picker-BD4KpZyr.js";import"./folder-row-mbxNJ6SZ.js";import"./chevron-right-Chf8xknM.js";import"./check-D_cIX8lf.js";import"./folder-BV9H1lCN.js";import"./new-folder-action-eQ7hXdHr.js";import"./new-folder-form-DZ-_va58.js";import"./field-label-DXw-fdZW.js";import"./search-BLZaoIk7.js";import"./label-chip-hR8ScyNA.js";import"./segmented-control-BgZCfGgK.js";const ir={title:"FilterRuleEditor",component:fe,parameters:{layout:"padded"},decorators:[e=>r.jsx("div",{className:"mx-auto max-w-md rounded-xl border border-line bg-surface",children:r.jsx(e,{})})]},l=(e,a)=>({status:"ready",count:e,stale:a});function s({initialRule:e,semanticAvailable:a=!0,initialMatchMode:i,propertyRule:u,labels:h=oe,initialClauseEdit:le,onCreateFolder:ge,onCreateLabel:ye}){const[b,d]=te.useState(e),[Ce,Re]=te.useState(i),[ae,f]=te.useState(le),Fe=te.useMemo(()=>l(b.clauses.length*23+(b.widen?40:0)),[b]),Se={onStartAddClause:()=>f({mode:"add",draft:{field:"From",value:""}}),onStartEditClause:o=>{const t=b.clauses.find(m=>m.id===o);t&&f({mode:"edit",clauseId:o,draft:{field:t.field,value:t.value}})},onRemoveClause:o=>{d(t=>({...t,clauses:t.clauses.filter(m=>m.id!==o)}))},onChangeDraftField:o=>f(t=>t&&{...t,draft:{...t.draft,field:o}}),onChangeDraftValue:o=>f(t=>t&&{...t,draft:{...t.draft,value:o}}),onSubmitClause:()=>{f(o=>{o&&d(t=>{if(o.mode==="add"){const m={id:`c-${Date.now()}`,field:o.draft.field,value:o.draft.value};return{...t,clauses:[...t.clauses,m]}}return{...t,clauses:t.clauses.map(m=>m.id===o.clauseId?{...m,field:o.draft.field,value:o.draft.value}:m)}})})},onCancelClause:()=>f(void 0),onAddWiden:()=>{d(o=>({...o,widen:{anchorCount:2}}))},onRemoveWiden:()=>{d(o=>({...o,widen:void 0}))},onChangeMatchOperator:o=>{d(t=>({...t,matchOperator:o}))},onChangeMatchMode:o=>{Re(o),d(t=>o==="properties"?{...t,clauses:(u??w).clauses,matchOperator:"any",widen:void 0}:{...t,clauses:e.clauses,matchOperator:e.matchOperator,widen:e.widen??{anchorCount:2}})},onChangeMove:o=>d(t=>({...t,moveMailboxId:o||void 0})),onChangeLabel:o=>d(t=>({...t,labelId:o||void 0})),onChangeScope:o=>d(t=>({...t,scope:o})),onChangeName:o=>d(t=>({...t,name:o})),onChangeUntil:o=>d(t=>({...t,until:o}))};return r.jsx(fe,{rule:b,folders:c,labels:h,preview:Fe,semanticAvailable:a,matchMode:Ce,clauseEdit:ae,clauseSuggestions:ae?Le(ae.draft.field,ae.draft.value):void 0,onCreateFolder:ge,onCreateLabel:ye,onCommit:()=>{},onCancel:()=>{},...Se})}const y={render:()=>r.jsx(s,{initialRule:n})},C={render:()=>r.jsx(s,{initialRule:{...n,clauses:[]},initialMatchMode:"similar",propertyRule:w})},R={render:()=>r.jsx(s,{initialRule:{...w,clauses:w.clauses.slice(0,1),scope:"once",name:""},initialMatchMode:"properties",propertyRule:w})},F={render:()=>r.jsx(s,{initialRule:ue,initialMatchMode:"properties",propertyRule:ue})},S={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"From",value:""}}})},E={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"FromDomain",value:""}}})},x={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"From",value:"someone@nowhere.test"}}})},A={render:()=>r.jsx(s,{initialRule:{...n,widen:void 0},semanticAvailable:!1,initialClauseEdit:{mode:"add",draft:{field:"Subject",value:"receipt"}}})},p=()=>new Promise(e=>setTimeout(e,60)),se=(e,a)=>{const i=Array.from(e.querySelectorAll("button")).find(u=>u.textContent?.trim()===a);if(!i)throw new Error(`no button reading "${a}"`);i.click()},ne=(e,a)=>{const i=e.querySelector(`[aria-label="${a}"]`);if(!i)throw new Error(`no control labelled "${a}"`);i.click()},Te=(e,a)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(e,a),e.dispatchEvent(new Event("input",{bubbles:!0}))},we=(e,a)=>{const u=Array.from(e.querySelectorAll("label")).find(le=>le.textContent?.trim()==="Folder name")?.getAttribute("for"),h=u?e.querySelector(`input[id="${u}"]`):null;if(!h)throw new Error("the folder name field is not on screen");Te(h,a)},ie=async e=>{se(e,"Choose a folder"),await p()},v=async(e,a)=>{ne(e,`Move to ${a}`),await p()};async function re(e,a,i){await ie(e),i?(await v(e,"Inbox"),await v(e,i),ne(e,`New folder inside ${i}`)):ne(e,"New folder"),await p(),we(e,a),await p(),se(e,"Create folder")}let pe=0;const de=(e,a)=>new Promise(i=>{pe+=1,setTimeout(()=>i({id:`mbx-new-${pe}`,label:e,path:a?`${a}/${e}`:e}),400)}),L={name:"Destination — browse the folder tree",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:de}),play:async({canvasElement:e})=>{await ie(e)}},T={name:"Destination — a nested folder and its same-named sibling",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:de}),play:async({canvasElement:e})=>{await ie(e),await v(e,"Inbox"),await v(e,"Travel")}},j={name:"New folder — inside the folder you opened",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:de}),play:async({canvasElement:e})=>{await ie(e),await v(e,"Inbox"),await v(e,"Travel"),ne(e,"New folder inside Travel"),await p(),we(e,"Car hire")}},ve="The folder was created but the mail server hasn't confirmed it yet, so nothing was attached to it. It's in your folder list — try again in a moment.",je=()=>new Promise(()=>{}),be=e=>()=>Promise.reject(new Error(e)),ke=()=>{let e=0;return(a,i)=>(e+=1,e===1?Promise.reject(new Error(ve)):Promise.resolve({id:"mbx-created",label:a,path:i?`${i}/${a}`:a}))},Ne=(e,a,i)=>new Promise((u,h)=>{i?.addEventListener("abort",()=>h(new DOMException("Aborted","AbortError")))}),k={name:"New folder — creating (waiting for the server)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:je}),play:async({canvasElement:e})=>{await re(e,"Receipts")}},N={name:"New folder — create failed (retry / cancel)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:be("The folder couldn't be created on the mail server. Please try again.")}),play:async({canvasElement:e})=>{await re(e,"Receipts")}},D={name:"New folder — create timed out (retry / cancel)",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:be(ve)}),play:async({canvasElement:e})=>{await re(e,"Receipts")}},M={name:"New folder — retry resumes and succeeds",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:ke()}),play:async({canvasElement:e})=>{await re(e,"Receipts","Travel"),await p(),se(e,"Create folder")}},P={name:"New folder — cancel aborts the wait",render:()=>r.jsx(s,{initialRule:n,onCreateFolder:Ne}),play:async({canvasElement:e})=>{await re(e,"Receipts"),await p(),se(e,"Cancel")}},I={render:()=>r.jsx(s,{initialRule:n,labels:[]})},O={render:()=>r.jsx(s,{initialRule:{...n,labelId:"lbl-receipts"}})},W={render:()=>r.jsx(s,{initialRule:n,labels:Array.from({length:20},(e,a)=>({id:`lbl-${a}`,name:`Label ${a+1}`,color:oe[a%oe.length].color}))})},$={render:()=>r.jsx(s,{initialRule:{...n,labelId:"lbl-long"},labels:[{id:"lbl-long",name:"Quarterly compliance filings that need a second look",color:"Purple"},...oe]})};let he=0;const De=e=>new Promise(a=>{he+=1,setTimeout(()=>a({id:`lbl-new-${he}`,name:e,color:"Default"}),400)}),Y={render:()=>r.jsx(s,{initialRule:n,onCreateLabel:De})},Me=()=>new Promise((e,a)=>{setTimeout(()=>a(new Error("That name is already taken.")),400)}),V={render:()=>r.jsx(s,{initialRule:n,onCreateLabel:Me})},_={render:()=>r.jsx(s,{initialRule:Ee})},q={args:{rule:{clauses:[{id:"c1",field:"Subject",value:"receipt"}],matchOperator:"all",moveMailboxId:"mbx-receipts",scope:"once"},folders:c,preview:l(12)}},U={args:{rule:n,folders:c,preview:l(47),semanticAvailable:!0}},B={args:{rule:{...n,scope:"until",until:"2026-09-01",name:"Conference"},folders:c,preview:l(31),semanticAvailable:!0}},G={render:()=>r.jsx(s,{initialRule:w,semanticAvailable:!1})},H={args:{rule:{...n,widen:void 0},folders:c,preview:l(24),semanticAvailable:!1}},Q={args:{rule:{...n,widen:{anchorCount:2,inactive:!0}},folders:c,preview:l(19),semanticAvailable:!1}},z={args:{rule:{...n,scope:"until",until:"2027-09-01",name:"Conference"},folders:c,preview:l(31),semanticAvailable:!1,anchorLocked:!0}},J={args:{rule:{clauses:[],matchOperator:"all",scope:"once"},folders:c,preview:l(0),semanticAvailable:!0}},K={args:{rule:n,folders:c,preview:{status:"loading"},semanticAvailable:!0}},X={args:{rule:n,folders:c,preview:l(47,!0),semanticAvailable:!0}},Z={args:{rule:n,folders:c,preview:{status:"error",reason:"Couldn't reach the server to count."},semanticAvailable:!0}},ee={render:()=>{const e=["From","Subject","HasWords","ListId","FromDomain"];return r.jsxs("div",{className:"space-y-4 p-4",children:[r.jsx("div",{className:"flex flex-wrap gap-2",children:e.map(a=>r.jsx(ce,{clause:{id:a,field:a,value:xe(a)},onEdit:()=>{},onRemove:()=>{}},a))}),r.jsxs("div",{className:"flex flex-wrap gap-2",children:[r.jsx(ce,{clause:{id:"d",field:"From",value:"receipts@stripe.com",derived:!0},onEdit:()=>{},onRemove:()=>{}}),r.jsx(me,{widen:{anchorCount:2},onRemove:()=>{}}),r.jsx(me,{widen:{anchorCount:2,inactive:!0}})]}),r.jsx(Ae,{draft:{field:"ListId",value:"python-dev.python.org"},mode:"edit",onChangeField:()=>{},onChangeValue:()=>{},onSubmit:()=>{},onCancel:()=>{}}),r.jsxs("div",{className:"space-y-2",children:[r.jsx(g,{preview:{status:"loading"}}),r.jsx(g,{preview:l(0)}),r.jsx(g,{preview:l(412)}),r.jsx(g,{preview:l(47,!0)}),r.jsx(g,{preview:{status:"error",reason:"Couldn't count."}})]})]})}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
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
new one where you are looking.`,...L.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "Destination — a nested folder and its same-named sibling",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await openDestinationTree(canvasElement);
    await openFolder(canvasElement, "Inbox");
    await openFolder(canvasElement, "Travel");
  }
}`,...T.parameters?.docs?.source},description:{story:`Two folders named Receipts, one at the top level and one inside Travel. The
tree tells them apart by where they sit; a list of leaf names could not.`,...T.parameters?.docs?.description}}};j.parameters={...j.parameters,docs:{...j.parameters?.docs,source:{originalSource:`{
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
}`,...j.parameters?.docs?.source},description:{story:"A new folder is made inside the folder the tree is looking at, so a filter can\npoint at `Travel/Car hire` without leaving the editor.",...j.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "New folder — creating (waiting for the server)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={neverResolvesCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...k.parameters?.docs?.source},description:{story:`The folder is a dependent write for the filter, so creating it waits for the
mail server to confirm the folder before it can be picked as the destination.
The wait is held in the form, which refuses a second submit while it runs.`,...k.parameters?.docs?.description}}};N.parameters={...N.parameters,docs:{...N.parameters?.docs,source:{originalSource:`{
  name: "New folder — create failed (retry / cancel)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={rejectingCreateFolder("The folder couldn't be created on the mail server. Please try again.")} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...N.parameters?.docs?.source},description:{story:`The folder create failed on the mail server. The rule is not committed against
a folder that does not exist: the error is surfaced inline with the create form
still open, so the create can be retried or cancelled.`,...N.parameters?.docs?.description}}};D.parameters={...D.parameters,docs:{...D.parameters?.docs,source:{originalSource:`{
  name: "New folder — create timed out (retry / cancel)",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={rejectingCreateFolder(TIMEOUT_MESSAGE)} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
  }
}`,...D.parameters?.docs?.source},description:{story:`The folder create was never confirmed within the wait bound. Distinct from a
hard failure — the message names the timeout — and, like a failure, leaves no
folder selected, so no filter is written against it.`,...D.parameters?.docs?.description}}};M.parameters={...M.parameters,docs:{...M.parameters?.docs,source:{originalSource:`{
  name: "New folder — retry resumes and succeeds",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={failThenSucceedCreateFolder()} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts", "Travel");
    await tick();
    clickText(canvasElement, "Create folder");
  }
}`,...M.parameters?.docs?.source},description:{story:`Retry is a resume: the first attempt times out (the folder was made but not yet
confirmed), and pressing "Create folder" again with the same name resolves —
the hook re-waits on the folder it already made rather than re-creating it, so
the retry the failure message points at actually works.`,...M.parameters?.docs?.description}}};P.parameters={...P.parameters,docs:{...P.parameters?.docs,source:{originalSource:`{
  name: "New folder — cancel aborts the wait",
  render: () => <LiveEditor initialRule={demoRule} onCreateFolder={abortAwareCreateFolder} />,
  play: async ({
    canvasElement
  }) => {
    await createFolderFromTree(canvasElement, "Receipts");
    await tick();
    clickText(canvasElement, "Cancel");
  }
}`,...P.parameters?.docs?.source},description:{story:`Cancelling while the create is in flight aborts the wait: the create promise
rejects with an AbortError the form swallows, so no destination binds after
the user backed out — the form just closes.`,...P.parameters?.docs?.description}}};I.parameters={...I.parameters,docs:{...I.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} labels={[]} />
}`,...I.parameters?.docs?.source},description:{story:'No labels exist yet in the account — the select offers only "No label".',...I.parameters?.docs?.description}}};O.parameters={...O.parameters,docs:{...O.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    labelId: "lbl-receipts"
  }} />
}`,...O.parameters?.docs?.source},description:{story:"A rule that already applies a label — the chip renders next to the select.",...O.parameters?.docs?.description}}};W.parameters={...W.parameters,docs:{...W.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} labels={Array.from({
    length: 20
  }, (_, i) => ({
    id: \`lbl-\${i}\`,
    name: \`Label \${i + 1}\`,
    color: demoLabels[i % demoLabels.length].color
  }))} />
}`,...W.parameters?.docs?.source},description:{story:"Many labels in the account — the select scrolls rather than the layout growing.",...W.parameters?.docs?.description}}};$.parameters={...$.parameters,docs:{...$.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={{
    ...demoRule,
    labelId: "lbl-long"
  }} labels={[{
    id: "lbl-long",
    name: "Quarterly compliance filings that need a second look",
    color: "Purple"
  }, ...demoLabels]} />
}`,...$.parameters?.docs?.source},description:{story:"A long label name truncates in the chip rather than overflowing the row.",...$.parameters?.docs?.description}}};Y.parameters={...Y.parameters,docs:{...Y.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabel} />
}`,...Y.parameters?.docs?.source},description:{story:`The label select offers a "＋ New label…" option because \`onCreateLabel\` is
wired (issue #26). Choosing it reveals a name field; on resolve the label is
added to the select and picked as the action. Without the prop the option
never shows — the editor stays data-agnostic.`,...Y.parameters?.docs?.description}}};V.parameters={...V.parameters,docs:{...V.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabelFailure} />
}`,...V.parameters?.docs?.source},description:{story:"Creating a label from the picker can fail — the field stays open with the reason.",...V.parameters?.docs?.description}}};_.parameters={..._.parameters,docs:{..._.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoVocabularyRule} />
}`,..._.parameters?.docs?.source},description:{story:'Literal clauses joined with "or", including the ticket-B ListId and FromDomain fields.',..._.parameters?.docs?.description}}};q.parameters={...q.parameters,docs:{...q.parameters?.docs,source:{originalSource:`{
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
}`,...q.parameters?.docs?.source},description:{story:'A one-time rule — no name, no widen, the commit reads "Apply now".',...q.parameters?.docs?.description}}};U.parameters={...U.parameters,docs:{...U.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: READY(47),
    semanticAvailable: true
  }
}`,...U.parameters?.docs?.source},description:{story:'Standing scope with a widen — the "keep doing this" rule.',...U.parameters?.docs?.description}}};B.parameters={...B.parameters,docs:{...B.parameters?.docs,source:{originalSource:`{
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
}`,...B.parameters?.docs?.source},description:{story:"Timed scope — the name and a date the rule stops on.",...B.parameters?.docs?.description}}};G.parameters={...G.parameters,docs:{...G.parameters?.docs,source:{originalSource:`{
  render: () => <LiveEditor initialRule={demoSenderFallbackRule} semanticAvailable={false} />
}`,...G.parameters?.docs?.source},description:{story:`The sender-fallback (#251) as chips: the derived From clauses are ordinary
visible, editable chips, not an invisible substitution.`,...G.parameters?.docs?.description}}};H.parameters={...H.parameters,docs:{...H.parameters?.docs,source:{originalSource:`{
  args: {
    rule: {
      ...demoRule,
      widen: undefined
    },
    folders: demoFolders,
    preview: READY(24),
    semanticAvailable: false
  }
}`,...H.parameters?.docs?.source},description:{story:`The deployment cannot serve the widen (RFC 038 D4): the "…and similar" add is
not offered and the rule matches by its literal clauses only.`,...H.parameters?.docs?.description}}};Q.parameters={...Q.parameters,docs:{...Q.parameters?.docs,source:{originalSource:`{
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
}`,...Q.parameters?.docs?.source},description:{story:`A standing rule that carries an anchor this deployment cannot evaluate — the
widen chip lists as inactive and nothing claims similarity is running.`,...Q.parameters?.docs?.description}}};z.parameters={...z.parameters,docs:{...z.parameters?.docs,source:{originalSource:`{
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
}`,...z.parameters?.docs?.source},description:{story:`Editing a persisted filter (RFC 038 D6, reader #266): scope and expiry stay
live and editable — a standing filter can move to "until a date" and back,
or its date can change. The semantic anchor is the one thing fixed at
creation: the widen chip renders display-only with a one-line note, and
"Just once" drops out of the scope toggle since no saved filter can hold it.`,...z.parameters?.docs?.description}}};J.parameters={...J.parameters,docs:{...J.parameters?.docs,source:{originalSource:`{
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
}`,...J.parameters?.docs?.source},description:{story:"Nothing to match yet — the commit says why it is blocked.",...J.parameters?.docs?.description}}};K.parameters={...K.parameters,docs:{...K.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: {
      status: "loading"
    },
    semanticAvailable: true
  }
}`,...K.parameters?.docs?.source},description:{story:"The live count while it recomputes — the commit waits for it to settle.",...K.parameters?.docs?.description}}};X.parameters={...X.parameters,docs:{...X.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: READY(47, true),
    semanticAvailable: true
  }
}`,...X.parameters?.docs?.source},description:{story:`The previewed set changed under the rule — recounting, never blank, and the
"Save rule" button is held disabled until the count that will be applied is
the count on screen (RFC 038's previewed-set-equals-applied-set contract).`,...X.parameters?.docs?.description}}};Z.parameters={...Z.parameters,docs:{...Z.parameters?.docs,source:{originalSource:`{
  args: {
    rule: demoRule,
    folders: demoFolders,
    preview: {
      status: "error",
      reason: "Couldn't reach the server to count."
    },
    semanticAvailable: true
  }
}`,...Z.parameters?.docs?.source},description:{story:"The preview failed — the count region raises it, the editor stays usable.",...Z.parameters?.docs?.description}}};ee.parameters={...ee.parameters,docs:{...ee.parameters?.docs,source:{originalSource:`{
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
}`,...ee.parameters?.docs?.source},description:{story:"Every clause and widen chip in isolation, including edit and inactive states.",...ee.parameters?.docs?.description}}};const lr=["Interactive","MatchModeSemanticDefault","MatchOnSenderProperty","MatchOnSubjectProperty","ClauseValueSuggestions","DomainClauseSuggestions","ClauseValueNoMatches","SubjectClauseStaysFreeText","DestinationTree","DestinationNestedFolders","NewFolderInsideAnother","NewFolderCreating","NewFolderCreateFailed","NewFolderCreateTimedOut","NewFolderCreateRetrySucceeds","NewFolderCreateCancelledMidWait","NoLabels","WithLabelSelected","ManyLabels","LongLabelNames","WithNewLabelOption","LabelCreateError","AnyOfTheseClauses","OneTimeMove","StandingWithWiden","UntilADate","SenderFallbackChips","SemanticUnavailable","DegradedStandingWiden","AnchorLocked","BlockedEmpty","PreviewLoading","PreviewStale","PreviewError","ChipGallery"];export{z as AnchorLocked,_ as AnyOfTheseClauses,J as BlockedEmpty,ee as ChipGallery,x as ClauseValueNoMatches,S as ClauseValueSuggestions,Q as DegradedStandingWiden,T as DestinationNestedFolders,L as DestinationTree,E as DomainClauseSuggestions,y as Interactive,V as LabelCreateError,$ as LongLabelNames,W as ManyLabels,C as MatchModeSemanticDefault,R as MatchOnSenderProperty,F as MatchOnSubjectProperty,P as NewFolderCreateCancelledMidWait,N as NewFolderCreateFailed,M as NewFolderCreateRetrySucceeds,D as NewFolderCreateTimedOut,k as NewFolderCreating,j as NewFolderInsideAnother,I as NoLabels,q as OneTimeMove,Z as PreviewError,K as PreviewLoading,X as PreviewStale,H as SemanticUnavailable,G as SenderFallbackChips,U as StandingWithWiden,A as SubjectClauseStaysFreeText,B as UntilADate,O as WithLabelSelected,Y as WithNewLabelOption,lr as __namedExportsOrder,ir as default};
