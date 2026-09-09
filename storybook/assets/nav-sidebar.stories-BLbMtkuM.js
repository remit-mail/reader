import{j as p}from"./iframe-R-hq3KXP.js";import{N as u}from"./nav-sidebar-DF8b5-rs.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-d2XQ1MEC.js";import"./roving-focus-j7U1alvJ.js";import"./account-service-status-DghfJ5l6.js";import"./badge-WI2U-Zts.js";import"./banner-BhQiwCh2.js";import"./button-DALtMcT0.js";import"./x-Czc64qis.js";import"./createLucideIcon-BDKPi14T.js";import"./sparkles-B6reTTZT.js";import"./calendar-days-uPmpgAOY.js";import"./star-rV5iOHKe.js";import"./chevron-down-kBBsVNj9.js";import"./chevron-right-C43QkeWJ.js";import"./circle-alert-CbTBTlom.js";import"./send-fSuxqJkf.js";import"./folder-6qgxSl-l.js";import"./trash-2-DVhxVVfp.js";import"./octagon-alert-DfH6ykI_.js";import"./mails-CUP9kWvq.js";import"./file-text-CJ_w3JkX.js";import"./inbox-D-FyjlM1.js";const x=[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",outboxPending:2,mailboxes:[{id:"personal-inbox",name:"Inbox",role:"inbox",unseen:12},{id:"personal-sent",name:"Sent",role:"sent"},{id:"personal-archive",name:"Archive",role:"archive"},{id:"personal-trash",name:"Trash",role:"trash"},{id:"personal-receipts",name:"Receipts",unseen:3},{id:"personal-travel",name:"Travel"}]},{id:"acct-work",label:"Work",email:"matthijs@work.example",outboxPending:0,mailboxes:[{id:"work-inbox",name:"Inbox",role:"inbox",unseen:4},{id:"work-sent",name:"Sent",role:"sent"},{id:"work-trash",name:"Trash",role:"trash"}]}],N={id:"acct-archivist",label:"Archivist",email:"archivist@example.com",mailboxes:[{id:"arch-inbox",name:"Inbox",role:"inbox",unseen:1},{id:"arch-sent",name:"Sent",role:"sent"},{id:"arch-trash",name:"Trash",role:"trash"},{id:"arch-clients",name:"Clients"},{id:"arch-invoices",name:"Invoices"},{id:"arch-projects",name:"Projects"},{id:"arch-newsletters",name:"Newsletters"},{id:"arch-receipts",name:"Receipts"},{id:"arch-travel",name:"Travel"},{id:"arch-legal",name:"Legal"},{id:"arch-taxes",name:"Taxes"},{id:"arch-misc",name:"Misc"},{id:"arch-2019",name:"2019"},{id:"arch-2020",name:"2020"}]},U={title:"Screens/Kit/NavSidebar",component:u,parameters:{layout:"fullscreen"},args:{accounts:x,briefUnseen:7,onSelectNav:()=>{}},render:m=>p.jsx("div",{className:"h-screen w-64 border-r border-line",children:p.jsx(u,{...m})})},a={args:{selectedNavId:"personal-inbox"}},r={args:{selectedNavId:"brief"}},s={args:{selectedNavId:"flagged"}},n={args:{selectedNavId:"settings"}},o={args:{accounts:[N],selectedNavId:"arch-inbox"}},I={id:"acct-hostnet",label:"Hostnet",email:"440737+mvhenten@users.noreply.github.com",mailboxes:[{id:"hn-inbox",name:"Inbox",role:"inbox",fullPath:"INBOX",unseen:8},{id:"hn-drafts",name:"Drafts",role:"drafts",fullPath:"INBOX/Drafts"},{id:"hn-sent",name:"Sent",role:"sent",fullPath:"INBOX/Sent"},{id:"hn-archive",name:"Archive",role:"archive",fullPath:"INBOX/Archive"},{id:"hn-spam",name:"Spam",role:"junk",fullPath:"INBOX/Spam",unseen:3},{id:"hn-trash",name:"Trash",role:"trash",fullPath:"INBOX/Deleted Messages"},{id:"hn-news",name:"Nieuwsbrieven",fullPath:"INBOX/Nieuwsbrieven",unseen:2}]},t={args:{accounts:[I],selectedNavId:"hn-inbox"}},c={args:{selectedNavId:"outbox"}},i={args:{accounts:[],selectedNavId:"brief"}},l={args:{accounts:[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",status:"loading",mailboxes:[]}],selectedNavId:"brief"}},d={args:{accounts:[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",status:"error",onRetry:()=>{},mailboxes:[]}],selectedNavId:"brief"}},e={args:{selectedNavId:"personal-inbox",linkComponent:({navId:m,className:h,ariaLabel:b,title:g,children:v})=>p.jsx("a",{href:`#/${m}`,className:h,"aria-label":b,title:g,children:v})}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "personal-inbox"
  }
}`,...a.parameters?.docs?.source}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "brief"
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "flagged"
  }
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "settings"
  }
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [manyFoldersAccount],
    selectedNavId: "arch-inbox"
  }
}`,...o.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [hostnetAccount],
    selectedNavId: "hn-inbox"
  }
}`,...t.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "outbox"
  }
}`,...c.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [],
    selectedNavId: "brief"
  }
}`,...i.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [{
      id: "acct-personal",
      label: "Personal",
      email: "matthijs@example.com",
      status: "loading",
      mailboxes: []
    }],
    selectedNavId: "brief"
  }
}`,...l.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [{
      id: "acct-personal",
      label: "Personal",
      email: "matthijs@example.com",
      status: "error",
      onRetry: () => undefined,
      mailboxes: []
    }],
    selectedNavId: "brief"
  }
}`,...d.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "personal-inbox",
    linkComponent: ({
      navId,
      className,
      ariaLabel,
      title,
      children
    }) => <a href={\`#/\${navId}\`} className={className} aria-label={ariaLabel} title={title}>
                {children}
            </a>
  }
}`,...e.parameters?.docs?.source},description:{story:"Each nav row is a real anchor: the linkComponent renders <a href>.",...e.parameters?.docs?.description}}};const q=["Default","Brief","Flagged","Settings","ManyFolders","Hostnet","WithOutbox","NoAccounts","Loading","LoadError","AsLinks"];export{e as AsLinks,r as Brief,a as Default,s as Flagged,t as Hostnet,d as LoadError,l as Loading,o as ManyFolders,i as NoAccounts,n as Settings,c as WithOutbox,q as __namedExportsOrder,U as default};
