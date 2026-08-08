import{j as e,r as d}from"./iframe-fAVmrNjG.js";import{Q as l,a as p}from"./quarantine-section-DZUqOdl9.js";import{q as g}from"./quarantine-fixtures-D9h4BXK6.js";import"./preload-helper-PPVm8Dsz.js";import"./button-C4vqyepI.js";import"./cn-yMAG7bfM.js";import"./dialog-dF5WUjjH.js";import"./createLucideIcon-E7hVbHyY.js";import"./external-link-BYuf7lAq.js";import"./banner-Bg20ohk7.js";import"./x-CiqSzl9P.js";import"./badge-CS1LQW7q.js";import"./folder-role-xpOeq73u.js";import"./inbox-wj8km1Ex.js";import"./mails-CHN9n9Cz.js";import"./send-B0c-OZLl.js";import"./octagon-alert-Mo52nP8d.js";import"./trash-2-Dodc-R2m.js";import"./star-DbXDvn6U.js";import"./bug-83mU2Ndx.js";import"./circle-check-Dd59-QkL.js";import"./triangle-alert-Bel_inG1.js";const[u,x,h,B]=g,m="https://github.com/remit-mail/reader/issues/new",z={title:"Settings/Quarantine",component:l,parameters:{layout:"padded"},args:{onCutBug:()=>{}},decorators:[i=>e.jsx("div",{className:"mx-auto max-w-2xl",children:e.jsx(i,{})})]},t={args:{entries:[]}},s={args:{entries:[u]}},o={args:{entries:[u,x,h]}},n={render:()=>{const[i,c]=d.useState(null),[y,C]=d.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(l,{entries:g,onCutBug:c}),y&&e.jsx("p",{className:"mt-3 text-xs text-positive",children:"Report copied."}),e.jsx(p,{entry:i,issueUrl:m,onClose:()=>c(null),onCopy:()=>C(!0)})]})}},r={render:()=>e.jsx(p,{entry:B,issueUrl:m,onClose:()=>{},onCopy:()=>{}})},a={render:()=>e.jsx(p,{entry:u,issueUrl:m,onClose:()=>{},onCopy:()=>{}})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source}}};const Y=["Empty","OneEntry","AlertState","CutABugFlow","BugReportWithoutMessageShape","BugReport"];export{o as AlertState,a as BugReport,r as BugReportWithoutMessageShape,n as CutABugFlow,t as Empty,s as OneEntry,Y as __namedExportsOrder,z as default};
