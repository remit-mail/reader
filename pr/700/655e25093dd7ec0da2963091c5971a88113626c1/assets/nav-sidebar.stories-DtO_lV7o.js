import{j as u}from"./iframe-fAVmrNjG.js";import{N as h}from"./nav-sidebar--rI1otrR.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./roving-focus-BJjVMA6b.js";import"./sparkles-DroEPvOz.js";import"./createLucideIcon-E7hVbHyY.js";import"./star-DbXDvn6U.js";import"./chevron-down-CV-Txd5h.js";import"./chevron-right-Chf8xknM.js";import"./bell-off-Aa9kf2Qp.js";import"./circle-alert-CLLSHsxA.js";import"./send-B0c-OZLl.js";import"./folder-BV9H1lCN.js";import"./search-BLZaoIk7.js";import"./x-CiqSzl9P.js";import"./trash-2-Dodc-R2m.js";import"./octagon-alert-Mo52nP8d.js";import"./mails-CHN9n9Cz.js";import"./inbox-wj8km1Ex.js";const S=[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",outboxPending:2,mailboxes:[{id:"personal-inbox",name:"Inbox",role:"inbox",unseen:12},{id:"personal-sent",name:"Sent",role:"sent"},{id:"personal-archive",name:"Archive",role:"archive"},{id:"personal-trash",name:"Trash",role:"trash"},{id:"personal-receipts",name:"Receipts",unseen:3},{id:"personal-travel",name:"Travel"}]},{id:"acct-work",label:"Work",email:"matthijs@work.example",outboxPending:0,mailboxes:[{id:"work-inbox",name:"Inbox",role:"inbox",unseen:4},{id:"work-sent",name:"Sent",role:"sent"},{id:"work-trash",name:"Trash",role:"trash"}]}],N={id:"acct-archivist",label:"Archivist",email:"archivist@example.com",mailboxes:[{id:"arch-inbox",name:"Inbox",role:"inbox",unseen:1},{id:"arch-sent",name:"Sent",role:"sent"},{id:"arch-trash",name:"Trash",role:"trash"},{id:"arch-clients",name:"Clients"},{id:"arch-invoices",name:"Invoices"},{id:"arch-projects",name:"Projects"},{id:"arch-newsletters",name:"Newsletters"},{id:"arch-receipts",name:"Receipts"},{id:"arch-travel",name:"Travel"},{id:"arch-legal",name:"Legal"},{id:"arch-taxes",name:"Taxes"},{id:"arch-misc",name:"Misc"},{id:"arch-2019",name:"2019"},{id:"arch-2020",name:"2020"}]},q={title:"Screens/Kit/NavSidebar",component:h,parameters:{layout:"fullscreen"},args:{accounts:S,briefUnseen:7,onSelectNav:()=>{}},render:p=>u.jsx("div",{className:"h-screen w-64 border-r border-line",children:u.jsx(h,{...p})})},r={args:{selectedNavId:"personal-inbox"}},s={args:{selectedNavId:"brief"}},n={args:{selectedNavId:"flagged"}},o={args:{selectedNavId:"settings"}},t={args:{accounts:[N],selectedNavId:"arch-inbox"}},f={id:"acct-hostnet",label:"Hostnet",email:"440737+mvhenten@users.noreply.github.com",mailboxes:[{id:"hn-inbox",name:"Inbox",role:"inbox",fullPath:"INBOX",unseen:8},{id:"hn-drafts",name:"Drafts",role:"drafts",fullPath:"INBOX/Drafts"},{id:"hn-sent",name:"Sent",role:"sent",fullPath:"INBOX/Sent"},{id:"hn-archive",name:"Archive",role:"archive",fullPath:"INBOX/Archive"},{id:"hn-spam",name:"Spam",role:"junk",fullPath:"INBOX/Spam",unseen:3},{id:"hn-trash",name:"Trash",role:"trash",fullPath:"INBOX/Deleted Messages"},{id:"hn-news",name:"Nieuwsbrieven",fullPath:"INBOX/Nieuwsbrieven",unseen:2}]},c={args:{accounts:[f],selectedNavId:"hn-inbox"}},i={args:{selectedNavId:"outbox"}},d={args:{accounts:[],selectedNavId:"brief"}},l={args:{accounts:[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",status:"loading",mailboxes:[]}],selectedNavId:"brief"}},m={args:{accounts:[{id:"acct-personal",label:"Personal",email:"matthijs@example.com",status:"error",onRetry:()=>{},mailboxes:[]}],selectedNavId:"brief"}},e={args:{selectedNavId:"personal-inbox",savedSearches:["from:alice has:attachment","account:work is:unread"],saveableQuery:"in:archive invoice",onSelectSavedSearch:()=>{},onRemoveSavedSearch:()=>{},onSaveCurrentSearch:()=>{}}},a={args:{selectedNavId:"personal-inbox",linkComponent:({navId:p,className:v,ariaLabel:b,title:g,children:x})=>u.jsx("a",{href:`#/${p}`,className:v,"aria-label":b,title:g,children:x})}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "personal-inbox"
  }
}`,...r.parameters?.docs?.source}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "brief"
  }
}`,...s.parameters?.docs?.source}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "flagged"
  }
}`,...n.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "settings"
  }
}`,...o.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [manyFoldersAccount],
    selectedNavId: "arch-inbox"
  }
}`,...t.parameters?.docs?.source}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [hostnetAccount],
    selectedNavId: "hn-inbox"
  }
}`,...c.parameters?.docs?.source}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "outbox"
  }
}`,...i.parameters?.docs?.source}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    accounts: [],
    selectedNavId: "brief"
  }
}`,...d.parameters?.docs?.source}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
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
}`,...l.parameters?.docs?.source}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
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
}`,...m.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    selectedNavId: "personal-inbox",
    savedSearches: ["from:alice has:attachment", "account:work is:unread"],
    saveableQuery: "in:archive invoice",
    onSelectSavedSearch: () => undefined,
    onRemoveSavedSearch: () => undefined,
    onSaveCurrentSearch: () => undefined
  }
}`,...e.parameters?.docs?.source},description:{story:`The reserved "Saved searches" group (#428 follow-up): saved queries plus a
"Save «query»" row when the active search isn't saved yet.`,...e.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
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
}`,...a.parameters?.docs?.source},description:{story:"Each nav row is a real anchor: the linkComponent renders <a href>.",...a.parameters?.docs?.description}}};const Q=["Default","Brief","Flagged","Settings","ManyFolders","Hostnet","WithOutbox","NoAccounts","Loading","LoadError","WithSavedSearches","AsLinks"];export{a as AsLinks,s as Brief,r as Default,n as Flagged,c as Hostnet,m as LoadError,l as Loading,t as ManyFolders,d as NoAccounts,o as Settings,i as WithOutbox,e as WithSavedSearches,Q as __namedExportsOrder,q as default};
