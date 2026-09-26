import{j as e,r as d}from"./iframe-DS5xN_9u.js";import{Q as l,a as p}from"./quarantine-section-8PzXDsZc.js";import{q as g}from"./quarantine-fixtures-CeVMvlCw.js";import"./preload-helper-PPVm8Dsz.js";import"./button-D5VdN6KM.js";import"./cn-d2XQ1MEC.js";import"./dialog-DVqRaD8m.js";import"./overlay-scope-BDkw0-iB.js";import"./keymap-dispatch-DTaqnLKC.js";import"./use-modal-focus-BzRR042d.js";import"./dialog-backdrop-Nj8MqML8.js";import"./copy-tuxMtiHa.js";import"./createLucideIcon-C2HcSaX7.js";import"./external-link-BswTnde0.js";import"./banner-rwqF0cjd.js";import"./x-BXk_suZj.js";import"./folder-tree-ZE9Jqoy_.js";import"./badge-BdLvSiDo.js";import"./folder-role-b75Tq5fi.js";import"./inbox-vUH_at4t.js";import"./file-text-C_3KKf4b.js";import"./send-DjOzwleH.js";import"./mails-BoRBLEPK.js";import"./octagon-alert-CCOJNZF_.js";import"./trash-2-DgSzqfOe.js";import"./star-CgqUZgOe.js";import"./bug-D_-d9so7.js";import"./circle-check-BVCtTCUa.js";import"./triangle-alert-WlZ9QUbm.js";const[u,x,h,B]=g,m="https://github.com/remit-mail/reader/issues/new",P={title:"Design System/Settings/Quarantine",component:l,parameters:{layout:"padded"},args:{onCutBug:()=>{}},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-2xl",children:e.jsx(i,{})})]},t={args:{entries:[]}},s={args:{entries:[u]}},o={args:{entries:[u,x,h]}},n={render:()=>{const[i,c]=d.useState(null),[y,C]=d.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(l,{entries:g,onCutBug:c}),y&&e.jsx("p",{className:"mt-3 text-xs text-positive",children:"Report copied."}),e.jsx(p,{entry:i,issueUrl:m,onClose:()=>c(null),onCopy:()=>C(!0)})]})}},r={render:()=>e.jsx(p,{entry:B,issueUrl:m,onClose:()=>{},onCopy:()=>{}})},a={render:()=>e.jsx(p,{entry:u,issueUrl:m,onClose:()=>{},onCopy:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    entries: []
  }
}`,...t.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    entries: [unterminatedBoundary]
  }
}`,...s.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    entries: [unterminatedBoundary, unknownCharset, truncatedBody]
  }
}`,...o.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => {
    const [open, setOpen] = useState<QuarantineEntry | null>(null);
    const [copied, setCopied] = useState(false);
    return <>
                <QuarantineSection entries={quarantineDemoEntries} onCutBug={setOpen} />
                {copied && <p className="mt-3 text-xs text-positive">Report copied.</p>}
                <QuarantineBugDialog entry={open} issueUrl={demoIssueUrl} onClose={() => setOpen(null)} onCopy={() => setCopied(true)} />
            </>;
  }
}`,...n.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <QuarantineBugDialog entry={shapeUnread} issueUrl={demoIssueUrl} onClose={() => {}} onCopy={() => {}} />
}`,...r.parameters?.docs?.source},description:{story:`A message that failed before its BODYSTRUCTURE was read carries no content
type, encoding, size or MIME tree, and one that declared no Message-ID
carries no hash. The report says so rather than printing an empty value.`,...r.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <QuarantineBugDialog entry={unterminatedBoundary} issueUrl={demoIssueUrl} onClose={() => {}} onCopy={() => {}} />
}`,...a.parameters?.docs?.source}}};const V=["Empty","OneEntry","AlertState","CutABugFlow","BugReportWithoutMessageShape","BugReport"];export{o as AlertState,a as BugReport,r as BugReportWithoutMessageShape,n as CutABugFlow,t as Empty,s as OneEntry,V as __namedExportsOrder,P as default};
