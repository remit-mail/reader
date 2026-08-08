import{j as a,r as k}from"./iframe-zw88L4Mq.js";import{F as L}from"./folder-tree-picker-iQVKiHaK.js";import{W as $,F as q,a as B}from"./selection-wizard-CPcu_a-j.js";import"./preload-helper-PPVm8Dsz.js";import"./folder-row-C7vKF0UV.js";import"./cn-yMAG7bfM.js";import"./chevron-right-CJC1fTbb.js";import"./createLucideIcon-AdIgPHc_.js";import"./check-DQN2CS7b.js";import"./folder-DVZhL6g4.js";import"./input-Cji_nj0c.js";import"./new-folder-action-BouqMrhc.js";import"./new-folder-form-B9MAmdbW.js";import"./button-B3Yk1mOK.js";import"./field-label-CWEwu_wo.js";import"./search-CGcOwy8T.js";import"./filter-clause-chip-D5W3pMza.js";import"./suggest-list-DVXPmXkz.js";import"./select-B6Imrwed.js";import"./chevron-down-D70ORMFZ.js";import"./x-BLGUIrqQ.js";import"./sparkles-C30yTofr.js";import"./badge-Ee126ieB.js";import"./blocked-reason-BF7Pr_SK.js";import"./progress-bar-DhBNO0WB.js";import"./search-conversion-notice-CxcIt44o.js";import"./folder-input-seYGeMV2.js";import"./info-BBsfqKst.js";import"./segmented-control-WM6knAuG.js";import"./arrow-left-B9o3nMag.js";import"./arrow-right-C4bXCahH.js";import"./triangle-alert-DvQXczKn.js";import"./loader-circle-C8k5aq3T.js";const S=[{id:"mbx-inbox",label:"Inbox",path:"INBOX",isCurrent:!0},{id:"mbx-archive",label:"Archive",path:"Archive"},{id:"mbx-sent",label:"Sent",path:"Sent Items"},{id:"mbx-spam",label:"Spam",path:"Junk"},{id:"mbx-trash",label:"Trash",path:"Deleted Messages"},{id:"mbx-travel",label:"Travel",path:"Travel"},{id:"mbx-travel-flights",label:"Flights",path:"Travel/Flights"},{id:"mbx-travel-hotels",label:"Hotels",path:"Travel/Hotels"},{id:"mbx-travel-hotels-receipts",label:"Receipts",path:"Travel/Hotels/Receipts"},{id:"mbx-travel-trains",label:"Trains",path:"Travel/Trains"},{id:"mbx-finance",label:"Finance",path:"Finance"},{id:"mbx-finance-invoices",label:"Invoices",path:"Finance/Invoices"},{id:"mbx-finance-invoices-2025",label:"2025",path:"Finance/Invoices/2025"},{id:"mbx-finance-invoices-2026",label:"2026",path:"Finance/Invoices/2026"},{id:"mbx-finance-tax",label:"Tax",path:"Finance/Tax"},{id:"mbx-family",label:"Family",path:"Family"},{id:"mbx-news",label:"Newsletters",path:"Newsletters"},{id:"mbx-news-tech",label:"Tech",path:"Newsletters/Tech"},{id:"mbx-news-design",label:"Design",path:"Newsletters/Design"},{id:"mbx-work",label:"Work",path:"Work"},{id:"mbx-work-projects",label:"Projects",path:"Work/Projects"},{id:"mbx-work-apollo",label:"Apollo",path:"Work/Projects/Apollo"},{id:"mbx-work-borealis",label:"Borealis",path:"Work/Projects/Borealis"},{id:"mbx-work-recruiting",label:"Recruiting",path:"Work/Recruiting"}],H=[...S,...Array.from({length:36},(e,r)=>({id:`mbx-client-${r}`,label:`Client ${String(r+1).padStart(2,"0")}`,path:`Work/Projects/Client ${String(r+1).padStart(2,"0")}`}))],je={title:"Mail/FolderTreePicker",component:L,parameters:{layout:"centered"}};function M({children:e}){return a.jsx("div",{className:"flex h-[560px] w-[360px] flex-col overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg shadow-lg",children:e})}let I=0;const R=(e,r)=>new Promise(t=>{I+=1,setTimeout(()=>t({id:`mbx-created-${I}`,label:e,path:r?`${r}/${e}`:e}),400)}),_=()=>new Promise(()=>{}),O=e=>()=>Promise.reject(new Error(e));function o({options:e=S,onCreateFolder:r=R}){const[t,j]=k.useState(),[N,c]=k.useState(e);return a.jsx(M,{children:a.jsx(L,{folders:N,selectedId:t,onSelect:j,onCreateFolder:(E,g,P)=>r(E,g,P).then(W=>(c(D=>[...D,W]),W))})})}const d={name:"Default (collapsed to top level)",render:()=>a.jsx(o,{})},F={name:"No create affordance",render:()=>{const e=()=>{const[r,t]=k.useState();return a.jsx(M,{children:a.jsx(L,{folders:S,selectedId:r,onSelect:t})})};return a.jsx(e,{})}},T={name:"Long list (scrolls)",render:()=>a.jsx(o,{options:H})},p={name:"No folders",render:()=>a.jsx(o,{options:[]})},z=(e,r)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(e,r),e.dispatchEvent(new Event("input",{bubbles:!0}))},K=(e,r)=>{const t=e.querySelector('input[type="search"]');t&&z(t,r)},i=(e,r)=>{e.querySelector(`button[aria-label="${r}"]`)?.click()},A=(e,r)=>{Array.from(e.querySelectorAll("button")).find(t=>t.textContent?.trim()===r)?.click()},l=(e,r)=>{const t=e.querySelector('input:not([type="search"])');t&&z(t,r)},n=()=>new Promise(e=>setTimeout(e,60)),s=async(e,...r)=>{for(const t of r)i(e,`Move to ${t}`),await n()},m={name:"A folder opened (children and its New folder)",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{await s(e,"Travel")}},h={name:"Opened three levels deep",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{await s(e,"Travel","Hotels","Receipts")}},f={name:"Filtered (ancestors opened for context)",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{K(e,"rec")}},C={name:"Create a top-level folder",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{i(e,"New folder"),await n(),l(e,"Insurance")}},u={name:"Create a folder inside an opened one",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await n(),l(e,"Car hire")}},w={name:"Create — waiting for the server",render:()=>a.jsx(o,{onCreateFolder:_}),play:async({canvasElement:e})=>{await s(e,"Finance"),i(e,"New folder inside Finance"),await n(),l(e,"Mortgage"),await n(),A(e,"Create folder")}},v={name:"Create — failed (retry in place)",render:()=>a.jsx(o,{onCreateFolder:O("The mail server refused the folder name. Try another one.")}),play:async({canvasElement:e})=>{await s(e,"Finance"),i(e,"New folder inside Finance"),await n(),l(e,"Mortgage"),await n(),A(e,"Create folder")}},y={name:"Create — kept while the list moves",render:()=>a.jsx(o,{}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await n(),l(e,"Car hire"),await n(),await s(e,"Finance")}},b={name:"Create — failed after the list moved",render:()=>a.jsx(o,{onCreateFolder:O("The mail server refused the folder name. Try another one.")}),play:async({canvasElement:e})=>{await s(e,"Travel"),i(e,"New folder inside Travel"),await n(),l(e,"Car hire"),await n(),A(e,"Create folder"),await n(),await s(e,"Finance")}},J=["match","folder","rule","review"];function V(){const[e,r]=k.useState(),[t,j]=k.useState(S),N=t.find(c=>c.id===e);return a.jsx($,{title:"Move to",subtitle:"Pick a destination",steps:J,step:"folder",onBack:()=>{},onExit:()=>{},footer:a.jsx(B,{onBack:()=>{},nextLabel:"Continue",onNext:()=>{},blockedReason:N?void 0:"Pick a folder to move into."}),children:a.jsx(q,{folders:t,mailboxId:e,onSelect:r,onCreateFolder:(c,E)=>R(c,E).then(g=>(j(P=>[...P,g]),g))})})}const x={name:"Phone — wizard folder step",parameters:{layout:"fullscreen"},globals:{viewport:{value:"mobile"}},render:()=>a.jsx(V,{}),play:async({canvasElement:e})=>{await s(e,"Travel")}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "Default (collapsed to top level)",
  render: () => <Picker />
}`,...d.parameters?.docs?.source},description:{story:`The list at rest: top level only, one tap deep into anything, with the pinned
"New folder" carrying the kit's dashed add affordance.`,...d.parameters?.docs?.description}}};F.parameters={...F.parameters,docs:{...F.parameters?.docs,source:{originalSource:`{
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
}`,...F.parameters?.docs?.source}}};T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "Long list (scrolls)",
  render: () => <Picker options={longFolders} />
}`,...T.parameters?.docs?.source}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "No folders",
  render: () => <Picker options={[]} />
}`,...p.parameters?.docs?.source},description:{story:"An account with nothing to list: the message states that, not a filter.",...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "A folder opened (children and its New folder)",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel");
  }
}`,...m.parameters?.docs?.source},description:{story:`One tap picks the destination and opens it. The children arrive indented,
with a quieter "New folder" at the end of them — the same action as the
pinned one, subordinate to the folder it sits in.`,...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "Opened three levels deep",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    await expand(canvasElement, "Travel", "Hotels", "Receipts");
  }
}`,...h.parameters?.docs?.source},description:{story:`One open branch, three levels deep: the ancestors stay open because the
folder you opened lives inside them.`,...h.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  name: "Filtered (ancestors opened for context)",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    typeFilter(canvasElement, "rec");
  }
}`,...f.parameters?.docs?.source},description:{story:`"rec" matches two nested folders. Their parents open to put them on screen
and read as the branches they are, not as an answer to what was typed.`,...f.parameters?.docs?.description}}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Create a top-level folder",
  render: () => <Picker />,
  play: async ({
    canvasElement
  }) => {
    clickAriaLabel(canvasElement, "New folder");
    await tick();
    typeFolderName(canvasElement, "Insurance");
  }
}`,...C.parameters?.docs?.source}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
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
}`,...u.parameters?.docs?.source},description:{story:`The folder you opened is the answer to "inside where": the form takes the
place of the action it came from, among that folder's children, and states
the parent as text — so there is no second choice to make.`,...u.parameters?.docs?.description}}};w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
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
confirms the folder, and refuses a second submit while it waits.`,...w.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
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
}`,...v.parameters?.docs?.source},description:{story:"The failure is stated where it happened; the form stays open to retry.",...v.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
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
the typed name and the folder it will be made in.`,...y.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
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
}`,...b.parameters?.docs?.source},description:{story:"A failure is stated where the user is looking, whatever the list has done.",...b.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
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
}`,...x.parameters?.docs?.source},description:{story:`The pattern at the size it is used: the wizard's folder step on a phone, with
a folder open so both create actions are on screen at once.`,...x.parameters?.docs?.description}}};const Ne=["Default","WithoutCreate","LongList","Empty","Expanded","DeepExpansion","Filtered","CreateTopLevel","CreateSubfolder","CreatePending","CreateFailed","CreateWhileTheListMoves","CreateFailedAfterTheListMoved","PhoneWizardStep"];export{v as CreateFailed,b as CreateFailedAfterTheListMoved,w as CreatePending,u as CreateSubfolder,C as CreateTopLevel,y as CreateWhileTheListMoves,h as DeepExpansion,d as Default,p as Empty,m as Expanded,f as Filtered,T as LongList,x as PhoneWizardStep,F as WithoutCreate,Ne as __namedExportsOrder,je as default};
