import{j as e,r as M}from"./iframe-fAVmrNjG.js";import{S as j}from"./search-results-BGnNXC_i.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-yMAG7bfM.js";import"./blocked-reason-D_Ul9I5k.js";import"./badge-CS1LQW7q.js";import"./folder-role-xpOeq73u.js";import"./inbox-wj8km1Ex.js";import"./createLucideIcon-E7hVbHyY.js";import"./mails-CHN9n9Cz.js";import"./send-B0c-OZLl.js";import"./octagon-alert-Mo52nP8d.js";import"./trash-2-Dodc-R2m.js";import"./star-DbXDvn6U.js";import"./message-row-Nk_lkf8_.js";import"./roving-focus-BJjVMA6b.js";import"./app-shell-types-DpJ4kEIP.js";import"./avatar-CaxZOEiX.js";import"./label-chip-hR8ScyNA.js";import"./shield-alert-C2HtGUTP.js";import"./paperclip-pIB-M0XR.js";import"./check-D_cIX8lf.js";import"./search-token-chip-D1dyw_Bk.js";import"./x-CiqSzl9P.js";import"./spam-results-offer-ChvVgKlE.js";import"./banner-Bg20ohk7.js";import"./button-C4vqyepI.js";import"./clock-VuHhFED6.js";import"./chevron-down-CV-Txd5h.js";const R=s=>e.jsx("div",{className:"overflow-y-auto rounded-lg border border-line bg-canvas",style:{width:360,height:640},children:e.jsx(s,{})}),H=["invoice march","from: stripe","flight confirmation"],g=[{id:"r1",sender:"Stripe",senderEmail:"receipts@stripe.com",subject:"Your invoice for March is ready",snippet:"Invoice #4821 — €149.00 paid on Visa ending 4242.",date:"9:42",unread:!0,category:{label:"Receipt",tone:"positive"}},{id:"r2",sender:"Hetzner Online",senderEmail:"billing@hetzner.com",subject:"Invoice 2026-03 available in your account",snippet:"Dear customer, your invoice for the period is attached.",date:"Mar 3",category:{label:"Finance",tone:"accent"}},{id:"r3",sender:"Anna de Vries",senderEmail:"anna@devries.nl",subject:"Re: Q1 invoice approval",snippet:"Approved — can you forward the PDF invoice to finance?",date:"Mar 1",flagged:!0}],y=[{id:"r5",sender:"QuickBooks",subject:"Reminder: 2 invoices awaiting payment",snippet:"You have outstanding invoices totalling €430.00.",date:"Feb 20",matchedChunkLabel:"body",score:.92},{id:"r6",sender:"noreply@vendor.io",subject:"Overdue invoice notice",snippet:"This invoice is now 14 days overdue. Please remit payment.",date:"Feb 12",matchedChunkLabel:"subject",score:.81}],S=[{id:"top",label:"Top matches",results:g},{id:"related",label:"Related",results:y}],w=[{id:"x1",sender:"Mollie",senderEmail:"info@mollie.com",subject:"Invoice 2026-02 — archived",snippet:"Filed last month; payment already settled.",date:"Feb 24",folder:{role:"archive"},category:{label:"Receipt",tone:"positive"}},{id:"x2",sender:"me",senderEmail:"matthijs@example.com",subject:"Re: invoice query",snippet:"Attaching the invoice you asked for.",date:"Feb 18",folder:{role:"sent"}},{id:"x4",sender:"Accountant",senderEmail:"jan@boekhouding.example",subject:"Invoices for the quarter",snippet:"The quarterly set, filed with the rest of the bookkeeping.",date:"Jan 30",folder:{providerPath:"Projects/Bookkeeping"}}],T=[{id:"s1",sender:"billing@unknown-vendor.test",senderEmail:"billing@unknown-vendor.test",subject:"URGENT invoice attached",snippet:"Wire the amount below within 24 hours to avoid suspension.",date:"Feb 11",folder:{role:"junk"}},{id:"s2",sender:"invoices@pay-now.test",senderEmail:"invoices@pay-now.test",subject:"Outstanding invoice — final notice",snippet:"Your account is overdue. Settle immediately.",date:"Feb 4",folder:{role:"junk"}}],k=[...g.map(s=>({...s,folder:{role:"inbox"}})),...w,...T],A=[{id:"top",label:"Top matches",results:[]}];function o(s){const[x,F]=M.useState(s.value);return e.jsx(j,{...s,value:x,onPickRecent:F})}const ne={title:"Kit/SearchResults",component:j,parameters:{layout:"centered"},decorators:[R]},r={render:()=>e.jsx(o,{value:"invoice",sections:S})},t={render:()=>e.jsx(o,{value:"asdfqwer",sections:A})},a={render:()=>e.jsx(o,{value:"invoice",sections:S,makeFilter:{onClick:()=>{}}})},n={render:()=>e.jsx(o,{value:"has:attachment",sections:S,makeFilter:{onClick:()=>{},blockedReason:"Add a sender or words to filter on"}})},i={render:()=>e.jsx(o,{value:"invoice",loading:!0})},c={render:()=>e.jsx(o,{value:"",recentSearches:H})},l={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"global",onScopeToSpam:()=>{}},sections:[{id:"top",label:"Top matches",results:k},{id:"related",label:"Related",results:y}]})},d={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"global",onScopeToSpam:()=>{}},sections:[{id:"top",label:"Top matches",results:k.filter(s=>s.folder?.role!=="junk")},{id:"related",label:"Related",results:y}]})},p={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"global",onScopeToSpam:()=>{}},sections:[{id:"top",label:"Top matches",results:w}]})},m={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"global",onScopeToSpam:()=>{}},sections:[{id:"top",label:"Top matches",results:T}]})},h={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"folder",role:"inbox"},sections:[{id:"top",label:"Top matches",results:k},{id:"related",label:"Related",results:y}]})},u={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"folder",role:"junk"},sections:[{id:"top",label:"Top matches",results:T}]})},v={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"global"},sections:[{id:"top",label:"Top matches",results:[{...g[0],id:"v1",folder:{role:"all"}},{...g[1],id:"v2",folder:{role:"flagged"}},{...g[2],id:"v3",folder:{providerPath:"[Gmail]/Important"}},...w.slice(0,1)]}]})},b={render:()=>e.jsx(o,{value:"invoice from:stripe.com has:attachment",sections:S,tokens:[{label:"From: stripe.com",onRemove:()=>{}},{label:"Has attachment",onRemove:()=>{}}]})},f={render:()=>e.jsx(o,{value:"invoice",scope:{kind:"collection"},sections:[{id:"top",label:"Top matches",results:k}]})};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" sections={resultSections} />
}`,...r.parameters?.docs?.source},description:{story:"The sectioned results the desktop list pane swaps in while a query is active.",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="asdfqwer" sections={emptySections} />
}`,...t.parameters?.docs?.source},description:{story:"A query that matches nothing.",...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" sections={resultSections} makeFilter={{
    onClick: () => {}
  }} />
}`,...a.parameters?.docs?.source},description:{story:'"Make this a filter" offered above active results (RFC 038 D5).',...a.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="has:attachment" sections={resultSections} makeFilter={{
    onClick: () => {},
    blockedReason: "Add a sender or words to filter on"
  }} />
}`,...n.parameters?.docs?.source},description:{story:`The filter offer dimmed — a search of only non-clause facets has nothing to
convert. It stays pressable, and pressing it puts the reason on screen.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" loading />
}`,...i.parameters?.docs?.source},description:{story:"Results still loading.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="" recentSearches={recentSearches} />
}`,...c.parameters?.docs?.source},description:{story:"Empty query: recent searches (the list pane shows the normal list instead).",...c.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: globalTopMatches
  }, {
    id: "related",
    label: "Related",
    results: related
  }]} />
}`,...l.parameters?.docs?.source},description:{story:`The daily brief's unscoped search: no scope chip in the bar, and the literal
section carries matches from every folder — Archive, Sent and custom folders
alongside the inbox. Each row says which folder it came from, because with
nothing scoping the search the folder is the only thing placing the result.

The two spam matches in the same data are not in this list. They are held out
and offered above it as a count.`,...l.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: globalTopMatches.filter(result => result.folder?.role !== "junk")
  }, {
    id: "related",
    label: "Related",
    results: related
  }]} />
}`,...d.parameters?.docs?.source},description:{story:`The same global search over an account whose Spam folder holds nothing
matching. No spam rows to hold out, so no offer — the offer only ever appears
because there is something behind it.`,...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: crossFolderMatches
  }]} />
}`,...p.parameters?.docs?.source},description:{story:"An account with no junk folder at all. Nothing is appointed `\\Junk`, so no\nrow can be spam and the component behaves exactly as it does when Spam is\nsimply empty — there is no separate case to handle.",...p.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: spamMatches
  }]} />
}`,...m.parameters?.docs?.source},description:{story:`A global search whose only matches are in Spam. The sections are empty, so
the empty state stands — with the offer above it, which is the whole reason
the user is not left thinking the search found nothing.`,...m.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "folder",
    role: "inbox"
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: globalTopMatches
  }, {
    id: "related",
    label: "Related",
    results: related
  }]} />
}`,...h.parameters?.docs?.source},description:{story:`Scoped to the inbox (its \`in:inbox\` chip in the bar), given the very same
rows as the global story — spam matches included. Nothing about Spam appears:
no rows, no count, no offer. A scoped search shows its own scope and no more,
and that asymmetry with the global view is deliberate.

The rows also drop their folder labels here. Every row is in the scoped
folder, so naming it on each one repeats the chip.`,...h.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "folder",
    role: "junk"
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: spamMatches
  }]} />
}`,...u.parameters?.docs?.source},description:{story:`Scoped to Spam — where taking the offer lands. Ordinary rows, rendered
normally, and no offer, because the user is already here. This is the same
scoped search reached by navigating to Spam with the query carried over; the
offer is a shortcut into it, not a mode of its own.`,...u.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "global"
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: [{
      ...topMatches[0],
      id: "v1",
      folder: {
        role: "all"
      }
    }, {
      ...topMatches[1],
      id: "v2",
      folder: {
        role: "flagged"
      }
    }, {
      ...topMatches[2],
      id: "v3",
      folder: {
        providerPath: "[Gmail]/Important"
      }
    }, ...crossFolderMatches.slice(0, 1)]
  }]} />
}`,...v.parameters?.docs?.source},description:{story:`A folder a search result can be in but never labelled with. All Mail and
Starred are views over mail filed elsewhere, and Gmail exposes them as
ordinary folders, so a row read from one carries no provenance label rather
than a misleading one. The other rows keep theirs.`,...v.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice from:stripe.com has:attachment" sections={resultSections} tokens={[{
    label: "From: stripe.com",
    onRemove: () => {}
  }, {
    label: "Has attachment",
    onRemove: () => {}
  }]} />
}`,...b.parameters?.docs?.source},description:{story:"Typed filter tokens (`from:`, `has:attachment`, …) render as removable chips above the sections.",...b.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <Harness value="invoice" scope={{
    kind: "collection"
  }} sections={[{
    id: "top",
    label: "Top matches",
    results: globalTopMatches
  }]} />
}`,...f.parameters?.docs?.source},description:{story:`Starred search (\`is:starred\` in the bar), given the same rows as the global
story. Starring is not a folder: the rows come from all over, so each keeps
its provenance label, and the two Spam matches stay in the list rather than
being held out. The user starred them; holding their own mail back from them
would be the surprising behaviour, and there is no offer because nothing was
taken away.`,...f.parameters?.docs?.description}}};const ie=["Results","NoResults","WithMakeFilter","MakeFilterBlocked","Loading","Idle","GlobalAcrossFolders","GlobalWithoutSpamMatches","GlobalAccountWithoutSpamFolder","GlobalOnlySpamMatches","ScopedToInbox","ScopedToSpam","VirtualFoldersGoUnlabelled","WithFilterTokens","StarredCollection"];export{p as GlobalAccountWithoutSpamFolder,l as GlobalAcrossFolders,m as GlobalOnlySpamMatches,d as GlobalWithoutSpamMatches,c as Idle,i as Loading,n as MakeFilterBlocked,t as NoResults,r as Results,h as ScopedToInbox,u as ScopedToSpam,f as StarredCollection,v as VirtualFoldersGoUnlabelled,b as WithFilterTokens,a as WithMakeFilter,ie as __namedExportsOrder,ne as default};
