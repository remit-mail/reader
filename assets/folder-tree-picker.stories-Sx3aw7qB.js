import{j as a,r as F}from"./iframe-uufGNBEn.js";import{F as L}from"./folder-tree-picker-DOwT19mg.js";import{W as q,F as H,a as _}from"./selection-wizard-ClJ9MpDG.js";import"./preload-helper-PPVm8Dsz.js";import"./folder-tree-ZE9Jqoy_.js";import"./folder-row-DSUXG5tk.js";import"./cn-d2XQ1MEC.js";import"./chevron-right-B0dowht5.js";import"./createLucideIcon-Bn-Stmx4.js";import"./check-BSgP79ub.js";import"./folder-C4FA7sra.js";import"./input-Cs8KaoXd.js";import"./new-folder-action-7vwcC7A5.js";import"./new-folder-form-5lRSXSZZ.js";import"./button-Wi0n0Lyz.js";import"./field-label-Bp6oPTgY.js";import"./search-DT0jdmVi.js";import"./semantic-off-D8uH6i9k.js";import"./filter-clause-chip-C7573bSY.js";import"./suggest-list-CAdYmTbd.js";import"./select-jAwdmlAP.js";import"./chevron-down-CGnGYV2L.js";import"./x-CuwWA0oJ.js";import"./sparkles-CHnxu8zM.js";import"./plus-ZS84sF7u.js";import"./badge-DS2l7jE5.js";import"./blocked-reason-C4Upi9m5.js";import"./arrow-left-DtwNLaK2.js";import"./progress-bar-DPUE27ne.js";import"./search-conversion-notice-BF-9b5VV.js";import"./search-conversion-BhyEgkS8.js";import"./folder-input-BXRE0zDI.js";import"./info-CzU_cXHr.js";import"./segmented-control-Cjrb0mMe.js";import"./arrow-right-ydrVB1r2.js";import"./triangle-alert-BMnL-Txz.js";import"./loader-circle-qkSTSuP1.js";const N=[{id:"mbx-inbox",label:"Inbox",path:"INBOX",isCurrent:!0},{id:"mbx-archive",label:"Archive",path:"Archive"},{id:"mbx-sent",label:"Sent",path:"Sent Items"},{id:"mbx-spam",label:"Spam",path:"Junk"},{id:"mbx-trash",label:"Trash",path:"Deleted Messages"},{id:"mbx-travel",label:"Travel",path:"Travel"},{id:"mbx-travel-flights",label:"Flights",path:"Travel/Flights"},{id:"mbx-travel-hotels",label:"Hotels",path:"Travel/Hotels"},{id:"mbx-travel-hotels-receipts",label:"Receipts",path:"Travel/Hotels/Receipts"},{id:"mbx-travel-trains",label:"Trains",path:"Travel/Trains"},{id:"mbx-finance",label:"Finance",path:"Finance"},{id:"mbx-finance-invoices",label:"Invoices",path:"Finance/Invoices"},{id:"mbx-finance-invoices-2025",label:"2025",path:"Finance/Invoices/2025"},{id:"mbx-finance-invoices-2026",label:"2026",path:"Finance/Invoices/2026"},{id:"mbx-finance-tax",label:"Tax",path:"Finance/Tax"},{id:"mbx-family",label:"Family",path:"Family"},{id:"mbx-news",label:"Newsletters",path:"Newsletters"},{id:"mbx-news-tech",label:"Tech",path:"Newsletters/Tech"},{id:"mbx-news-design",label:"Design",path:"Newsletters/Design"},{id:"mbx-work",label:"Work",path:"Work"},{id:"mbx-work-projects",label:"Projects",path:"Work/Projects"},{id:"mbx-work-apollo",label:"Apollo",path:"Work/Projects/Apollo"},{id:"mbx-work-borealis",label:"Borealis",path:"Work/Projects/Borealis"},{id:"mbx-work-recruiting",label:"Recruiting",path:"Work/Recruiting"}],K=[{id:"mbx-inbox",label:"Inbox",path:"INBOX",isCurrent:!0},{id:"mbx-archive",label:"Archive",path:"Archive"},{id:"mbx-work",label:"Work",path:"Work"},{id:"mbx-workshop",label:"Workshop",path:"Workshop"},{id:"mbx-sent",label:"Sent",path:"Sent Items"},{id:"mbx-trash",label:"Trash",path:"Deleted Messages"}],X=[...N,...Array.from({length:36},(e,r)=>({id:`mbx-client-${r}`,label:`Client ${String(r+1).padStart(2,"0")}`,path:`Work/Projects/Client ${String(r+1).padStart(2,"0")}`}))],Ie={title:"Mail/FolderTreePicker",component:L,parameters:{layout:"centered"}};function R({children:e}){return a.jsx("div",{className:"flex h-[560px] w-[360px] flex-col overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg shadow-lg",children:e})}let M=0;const O=(e,r)=>new Promise(t=>{M+=1,setTimeout(()=>t({id:`mbx-created-${M}`,label:e,path:r?`${r}/${e}`:e}),400)}),J=()=>new Promise(()=>{}),D=e=>()=>Promise.reject(new Error(e));function n({options:e=N,onCreateFolder:r=O,delimiter:t}){const[j,P]=F.useState(),[c,E]=F.useState(e);return a.jsx(R,{children:a.jsx(L,{folders:c,selectedId:j,delimiter:t,onSelect:P,onCreateFolder:(g,A,$)=>r(g,A,$).then(I=>(E(B=>[...B,I]),I))})})}const d={name:"Default (collapsed to top level)",render:()=>a.jsx(n,{})},T={name:"No create affordance",render:()=>{const e=()=>{const[r,t]=F.useState();return a.jsx(R,{children:a.jsx(L,{folders:N,selectedId:r,onSelect:t})})};return a.jsx(e,{})}},C={name:"Long list (scrolls)",render:()=>a.jsx(n,{options:X})},p={name:"Flat namespace (server reports no delimiter)",render:()=>a.jsx(n,{options:K,delimiter:""})},m={name:"No folders",render:()=>a.jsx(n,{options:[]})},z=(e,r)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(e,r),e.dispatchEvent(new Event("input",{bubbles:!0}))},V=(e,r)=>{const t=e.querySelector('input[type="search"]');t&&z(t,r)},i=(e,r)=>{e.querySelector(`button[aria-label="${r}"]`)?.click()},W=(e,r)=>{Array.from(e.querySelectorAll("button")).find(t=>t.textContent?.trim()===r)?.click()},l=(e,r)=>{const t=e.querySelector('input:not([type="search"])');t&&z(t,r)},o=()=>new Promise(e=>setTimeout(e,60)),s=async(e,...r)=>{for(const t of r)i(e,`Move to ${t}`),await o()},h={name:"A folder opened (children and its New folder)",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{await s(e,"Travel")}},f={name:"Opened three levels deep",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{await s(e,"Travel","Hotels","Receipts")}},u={name:"Filtered (ancestors opened for context)",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{V(e,"rec")}},S={name:"Create a top-level folder",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{i(e,"New folder"),await o(),l(e,"Insurance")}},v={name:"Create a folder inside an opened one",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await o(),l(e,"Car hire")}},w={name:"Create — waiting for the server",render:()=>a.jsx(n,{onCreateFolder:J}),play:async({canvasElement:e})=>{await s(e,"Finance"),i(e,"New folder inside Finance"),await o(),l(e,"Mortgage"),await o(),W(e,"Create folder")}},b={name:"Create — failed (retry in place)",render:()=>a.jsx(n,{onCreateFolder:D("The mail server refused the folder name. Try another one.")}),play:async({canvasElement:e})=>{await s(e,"Finance"),i(e,"New folder inside Finance"),await o(),l(e,"Mortgage"),await o(),W(e,"Create folder")}},y={name:"Create — kept while the list moves",render:()=>a.jsx(n,{}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await o(),l(e,"Car hire"),await o(),await s(e,"Finance")}},x={name:"Create — failed after the list moved",render:()=>a.jsx(n,{onCreateFolder:D("The mail server refused the folder name. Try another one.")}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await o(),l(e,"Car hire"),await o(),W(e,"Create folder"),await o(),await s(e,"Finance")}},G=["match","folder","rule","review"];function Q(){const[e,r]=F.useState(),[t,j]=F.useState(N),P=t.find(c=>c.id===e);return a.jsx(q,{title:"Move to",subtitle:"Pick a destination",steps:G,step:"folder",onBack:()=>{},onExit:()=>{},footer:a.jsx(_,{onBack:()=>{},nextLabel:"Continue",onNext:()=>{},blockedReason:P?void 0:"Pick a folder to move into."}),children:a.jsx(H,{folders:t,mailboxId:e,onSelect:r,onCreateFolder:(c,E)=>O(c,E).then(g=>(j(A=>[...A,g]),g))})})}const k={name:"Phone — wizard folder step",parameters:{layout:"fullscreen"},globals:{viewport:{value:"mobile"}},render:()=>a.jsx(Q,{}),play:async({canvasElement:e})=>{await s(e,"Travel")}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Default (collapsed to top level)",
  render: () => <Picker />
}`,...d.parameters?.docs?.source},description:{story:`The list at rest: top level only, one tap deep into anything, with the pinned
"New folder" carrying the kit's dashed add affordance.`,...d.parameters?.docs?.description}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "No create affordance",
  render: () => {
    const ReadOnly = () => {
      const [selected, setSelected] = useState<string>();
      return <Frame>
                    <FolderTreePicker folders={folders} selectedId={selected} onSelect={setSelected} />
                </Frame>;
    };
    return <ReadOnly />;
  }
}`,...T.parameters?.docs?.source}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Long list (scrolls)",
  render: () => <Picker options={longFolders} />
}`,...C.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Flat namespace (server reports no delimiter)",
  render: () => <Picker options={flatFolders} delimiter="" />
}`,...p.parameters?.docs?.source},description:{story:`A flat namespace: every folder sits at the top level and none of them opens,
so a new folder can only be made at the top.`,...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "No folders",
  render: () => <Picker options={[]} />
}`,...m.parameters?.docs?.source},description:{story:"An account with nothing to list: the message states that, not a filter.",...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "A folder opened (children and its New folder)",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
  }
}`,...h.parameters?.docs?.source},description:{story:`One tap picks the destination and opens it. The children arrive indented,
with a quieter "New folder" at the end of them — the same action as the
pinned one, subordinate to the folder it sits in.`,...h.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  name: "Opened three levels deep",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel", "Hotels", "Receipts");
  }
}`,...f.parameters?.docs?.source},description:{story:`One open branch, three levels deep: the ancestors stay open because the
folder you opened lives inside them.`,...f.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  name: "Filtered (ancestors opened for context)",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    typeFilter(canvasElement, "rec");
  }
}`,...u.parameters?.docs?.source},description:{story:`"rec" matches two nested folders. Their parents open to put them on screen
and read as the branches they are, not as an answer to what was typed.`,...u.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  name: "Create a top-level folder",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    clickAriaLabel(canvasElement, "New folder");
    await tick();
    typeFolderName(canvasElement, "Insurance");
  }
}`,...S.parameters?.docs?.source}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  name: "Create a folder inside an opened one",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
    clickAriaLabel(canvasElement, "New folder inside Travel");
    await tick();
    typeFolderName(canvasElement, "Car hire");
  }
}`,...v.parameters?.docs?.source},description:{story:`The folder you opened is the answer to "inside where": the form takes the
place of the action it came from, among that folder's children, and states
the parent as text — so there is no second choice to make.`,...v.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  name: "Create — waiting for the server",
  render: () => <Picker onCreateFolder={neverResolves} />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Finance");
    clickAriaLabel(canvasElement, "New folder inside Finance");
    await tick();
    typeFolderName(canvasElement, "Mortgage");
    await tick();
    clickText(canvasElement, "Create folder");
  }
}`,...w.parameters?.docs?.source},description:{story:`Creating a folder is an IMAP mutation: the form holds until the mail server
confirms the folder, and refuses a second submit while it waits.`,...w.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  name: "Create — failed (retry in place)",
  render: () => <Picker onCreateFolder={rejects("The mail server refused the folder name. Try another one.")} />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Finance");
    clickAriaLabel(canvasElement, "New folder inside Finance");
    await tick();
    typeFolderName(canvasElement, "Mortgage");
    await tick();
    clickText(canvasElement, "Create folder");
  }
}`,...b.parameters?.docs?.source},description:{story:"The failure is stated where it happened; the form stays open to retry.",...b.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  name: "Create — kept while the list moves",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
    clickAriaLabel(canvasElement, "New folder inside Travel");
    await tick();
    typeFolderName(canvasElement, "Car hire");
    await tick();
    await expand(canvasElement, "Finance");
  }
}`,...y.parameters?.docs?.source},description:{story:`Looking somewhere else does not throw the draft away: opening another folder
closes the branch the form was in, and the form is pinned above the tree with
the typed name and the folder it will be made in.`,...y.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  name: "Create — failed after the list moved",
  render: () => <Picker onCreateFolder={rejects("The mail server refused the folder name. Try another one.")} />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
    clickAriaLabel(canvasElement, "New folder inside Travel");
    await tick();
    typeFolderName(canvasElement, "Car hire");
    await tick();
    clickText(canvasElement, "Create folder");
    await tick();
    await expand(canvasElement, "Finance");
  }
}`,...x.parameters?.docs?.source},description:{story:"A failure is stated where the user is looking, whatever the list has done.",...x.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "Phone — wizard folder step",
  parameters: {
    layout: "fullscreen"
  },
  globals: {
    viewport: {
      value: "mobile"
    }
  },
  render: () => <WizardFolderStep />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
  }
}`,...k.parameters?.docs?.source},description:{story:`The pattern at the size it is used: the wizard's folder step on a phone, with
a folder open so both create actions are on screen at once.`,...k.parameters?.docs?.description}}};const Me=["Default","WithoutCreate","LongList","FlatNamespace","Empty","Expanded","DeepExpansion","Filtered","CreateTopLevel","CreateSubfolder","CreatePending","CreateFailed","CreateWhileTheListMoves","CreateFailedAfterTheListMoved","PhoneWizardStep"];export{b as CreateFailed,x as CreateFailedAfterTheListMoved,w as CreatePending,v as CreateSubfolder,S as CreateTopLevel,y as CreateWhileTheListMoves,f as DeepExpansion,d as Default,m as Empty,h as Expanded,u as Filtered,p as FlatNamespace,C as LongList,k as PhoneWizardStep,T as WithoutCreate,Me as __namedExportsOrder,Ie as default};
