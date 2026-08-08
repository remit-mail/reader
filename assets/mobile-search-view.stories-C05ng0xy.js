import{j as e,r as i}from"./iframe-zw88L4Mq.js";import{b as J,i as U}from"./filter-presets-DijoMGkm.js";import{u as X,S as Z}from"./suggest-list-DVXPmXkz.js";import{M as N}from"./mobile-search-view-flKAqKM6.js";import"./preload-helper-PPVm8Dsz.js";import"./brief-sections-C5_algbC.js";import"./roving-focus-5ii5MRPr.js";import"./app-shell-types-LVfosKXZ.js";import"./brief-section-Vk7RjgtA.js";import"./cn-yMAG7bfM.js";import"./chevron-down-D70ORMFZ.js";import"./createLucideIcon-AdIgPHc_.js";import"./filter-sheet-oKRRHI_0.js";import"./row-keyboard-4SpR8O0u.js";import"./badge-Ee126ieB.js";import"./button-B3Yk1mOK.js";import"./search-bar-CN6aBhgi.js";import"./search-chip-input-CvCaVhfi.js";import"./search-token-chip-DW0cHP4F.js";import"./x-BLGUIrqQ.js";import"./search-CGcOwy8T.js";import"./search-results-B5_LFcxA.js";import"./blocked-reason-BF7Pr_SK.js";import"./folder-role-CkcK2HB8.js";import"./inbox-xh3kJz_j.js";import"./mails-FLpZPIdm.js";import"./send-BN5Q90Ut.js";import"./octagon-alert-Bt3CD9jY.js";import"./trash-2-Du3oCQXI.js";import"./star-Dn8uDbft.js";import"./message-row-CcCINhiH.js";import"./avatar-CZJ-LrXe.js";import"./label-chip-DCJIAgrz.js";import"./shield-alert-C0MDecMU.js";import"./paperclip-CYiOVWYx.js";import"./check-DQN2CS7b.js";import"./spam-results-offer-D8ndPsp7.js";import"./banner-zJdgs6dW.js";import"./clock-C5sAgOYf.js";const ee=a=>e.jsx("div",{className:"overflow-hidden rounded-lg border border-line",style:{width:390,height:720},children:e.jsx(a,{})}),te=[{id:"personal",label:"matthijs@",count:42,active:!0},{id:"work",label:"work@acme",count:17}],se=["invoice march","from: stripe","flight confirmation"],F=[{id:"r1",sender:"Stripe",senderEmail:"receipts@stripe.com",subject:"Your invoice for March is ready",snippet:"Invoice #4821 — €149.00 paid on Visa ending 4242.",date:"9:42",unread:!0,category:{label:"Receipt",tone:"positive"}},{id:"r2",sender:"Hetzner Online",senderEmail:"billing@hetzner.com",subject:"Invoice 2026-03 available in your account",snippet:"Dear customer, your invoice for the period is attached.",date:"Mar 3",category:{label:"Finance",tone:"accent"}},{id:"r3",sender:"Anna de Vries",senderEmail:"anna@devries.nl",subject:"Re: Q1 invoice approval",snippet:"Approved — can you forward the PDF invoice to finance?",date:"Mar 1",flagged:!0},{id:"r4",sender:"AWS Billing",senderEmail:"no-reply@aws.amazon.com",subject:"Your invoice is now available",snippet:"Your total for February was $312.55 across 6 services.",date:"Feb 28",category:{label:"Finance",tone:"accent"}}],M=[{id:"r5",sender:"QuickBooks",subject:"Reminder: 2 invoices awaiting payment",snippet:"You have outstanding invoices totalling €430.00.",date:"Feb 20",category:{label:"Reminder",tone:"warning"},threadId:"thread-quickbooks",mailboxId:"mailbox-personal"},{id:"r6",sender:"noreply@vendor.io",subject:"Overdue invoice notice",snippet:"This invoice is now 14 days overdue. Please remit payment.",date:"Feb 12",category:{label:"Overdue",tone:"danger"},threadId:"thread-vendor",mailboxId:"mailbox-personal"}],T=[{id:"top",label:"Top matches",results:F},{id:"related",label:"Related",results:M}],re=[{id:"top",label:"Top matches",results:[]},{id:"related",label:"Related",results:[]}],oe=[{...F[0],folder:{role:"inbox"}},{...F[1],folder:{role:"inbox"}},{id:"x1",sender:"Mollie",senderEmail:"info@mollie.com",subject:"Invoice 2026-02 — archived",snippet:"Filed last month; payment already settled.",date:"Feb 24",folder:{role:"archive"}},{id:"x2",sender:"Accountant",senderEmail:"jan@boekhouding.example",subject:"Invoices for the quarter",snippet:"The quarterly set, filed with the rest of the bookkeeping.",date:"Jan 30",folder:{providerPath:"Projects/Bookkeeping"}}],V=[{id:"s1",sender:"billing@unknown-vendor.test",senderEmail:"billing@unknown-vendor.test",subject:"URGENT invoice attached",snippet:"Wire the amount below within 24 hours to avoid suspension.",date:"Feb 11",folder:{role:"junk"}},{id:"s2",sender:"invoices@pay-now.test",senderEmail:"invoices@pay-now.test",subject:"Outstanding invoice — final notice",snippet:"Your account is overdue. Settle immediately.",date:"Feb 4",folder:{role:"junk"}}],I=[{id:"top",label:"Top matches",results:[...oe,...V]}],ne=[{value:"in:Archive",label:"Archive",hint:"matthijs@ischen.nl"},{value:"in:Inbox",label:"Inbox",hint:"matthijs@ischen.nl"},{value:'in:"Sent Items"',label:"Sent Items",hint:"work@acme.test"},{value:"in:Spam",label:"Spam",hint:"matthijs@ischen.nl"}],H=(a,c)=>{const w=a.slice(0,a.search(/\S*$/));return c.value.endsWith(":")?w+c.value:`${w+c.value} `};function t({initialValue:a="",initialChips:c=[],loading:w,sections:q,preset:G,scope:O,makeFilterBlockedReason:P,suggestions:C=[]}){const[B,l]=i.useState(a),[D,L]=i.useState(c),[Y,R]=i.useState("all"),[z,A]=i.useState(new Set),[K,W]=i.useState("personal"),[$,Q]=i.useState(!1),[j,E]=i.useState(null),n=X({count:C.length,onAccept:s=>{const r=C[s];r&&l(o=>H(o,r))}}),_=G==="brief"?J(te.map(s=>({...s,active:s.id===K}))):U();return j?e.jsxs("div",{className:"flex h-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center text-sm",children:[e.jsx("p",{className:"font-semibold text-fg",children:"Opened conversation"}),e.jsx("p",{className:"text-fg-muted",children:j.subject}),e.jsxs("p",{className:"text-2xs text-fg-subtle",children:["thread ",j.threadId??"(none)"," · mailbox"," ",j.mailboxId??"(none)"]}),e.jsx("button",{type:"button",className:"mt-2 text-2xs text-accent underline",onClick:()=>E(null),children:"Back to search"})]}):e.jsx(N,{value:B,onChange:l,onClear:()=>l(""),onCancel:()=>{},chips:D,onRemoveChip:s=>L(r=>r.filter(o=>o.id!==s)),filter:{..._,selectedCategory:Y,activeFilters:z,expanded:$,onExpandedChange:Q,onSelectCategory:R,onSelectSource:W,onToggleFilter:s=>A(r=>{const o=new Set(r);return o.has(s)?o.delete(s):o.add(s),o}),onClear:()=>{R("all"),A(new Set)}},recentSearches:se,onPickRecent:l,sections:q,loading:w,onSelectResult:E,scope:O,makeFilter:{onClick:()=>{},blockedReason:P},suggest:{comboboxProps:n.comboboxProps,onKeyDown:n.handleKeyDown,onCaretChange:()=>{}},suggestList:n.open?e.jsx(Z,{id:n.listId,suggestions:C,activeIndex:n.activeIndex,optionId:n.optionId,onPick:s=>l(r=>H(r,s)),onHighlight:n.setActiveIndex,label:"Search suggestions",className:"mx-row-inset mt-1 shrink-0"}):null})}const Ke={title:"Kit/MobileSearchView",component:N,parameters:{layout:"centered"},decorators:[ee]},d={render:()=>e.jsx(t,{initialValue:"invoice",sections:T,preset:"brief"})},p={render:()=>e.jsx(t,{initialValue:"invoice",sections:T,preset:"inbox"})},h={render:()=>e.jsx(t,{initialValue:"has:attachment",sections:T,preset:"inbox",makeFilterBlockedReason:"Add a sender or words to filter on"})},m={render:()=>e.jsx(t,{initialValue:"in:",sections:T,preset:"inbox",suggestions:ne})},u={render:()=>e.jsx(t,{preset:"brief"})},b={render:()=>e.jsx(t,{initialValue:"asdfqwer",sections:re,preset:"brief"})},g={render:()=>e.jsx(t,{initialValue:"invoice",loading:!0,preset:"brief"})},f={render:()=>e.jsx(t,{initialValue:"invoice",sections:[{id:"related",label:"Related",results:M}],preset:"brief"})},v={render:()=>e.jsx(t,{initialValue:"invoice",initialChips:[{id:"in:spam",label:"in:spam"}],sections:[{id:"top",label:"Top matches",results:V}],scope:{kind:"folder",role:"junk"},preset:"inbox"})},S={render:()=>e.jsx(t,{initialValue:"invoice",sections:I,scope:{kind:"global",onScopeToSpam:()=>{}},preset:"brief"})},x={render:()=>e.jsx(t,{initialValue:"invoice",initialChips:[{id:"in:inbox",label:"in:inbox"}],sections:I,scope:{kind:"folder",role:"inbox"},preset:"inbox"})},y={render:()=>e.jsx(t,{initialValue:"invoice",sections:[{id:"top",label:"Top matches",results:V}],scope:{kind:"global",onScopeToSpam:()=>{}},preset:"brief"})},k={render:()=>e.jsx(t,{initialValue:"invoice",initialChips:[{id:"is:starred",label:"is:starred"}],sections:I,scope:{kind:"collection"},preset:"brief"})};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" sections={resultSections} preset="brief" />
}`,...d.parameters?.docs?.source},description:{story:`Global search — the daily-brief preset. The filter chrome is not up: a query
supersedes it, and the row above the results belongs to the conversion the
search itself offers. The header carries a single X that clears the query AND
dismisses the takeover.`,...d.parameters?.docs?.description}}};p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" sections={resultSections} preset="inbox" />
}`,...p.parameters?.docs?.source},description:{story:`Scoped search — a single inbox. It reads exactly like the global one above:
search is scoped by where the user is and differs in nothing else, so the
conversion is offered here too.`,...p.parameters?.docs?.description}}};h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="has:attachment" sections={resultSections} preset="inbox" makeFilterBlockedReason="Add a sender or words to filter on" />
}`,...h.parameters?.docs?.source},description:{story:`A query with nothing a filter could match on: the conversion stays offered and
dimmed, rather than withheld and leaving the row to appear and vanish as the
user types. Pressing it puts the reason on screen.`,...h.parameters?.docs?.description}}};m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="in:" sections={resultSections} preset="inbox" suggestions={folderSuggestions} />
}`,...m.parameters?.docs?.source},description:{story:`A committed token name: the folders \`in:\` can name, offered under the field.

The list takes its own space between the field and the results rather than
floating over them — a soft keyboard owns the lower half of this screen, and a
list over the field would cover the query it is completing. Arrows move the
highlight, Enter takes it, Escape closes the list and leaves the query.`,...m.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <Harness preset="brief" />
}`,...u.parameters?.docs?.source},description:{story:`Empty query: recent searches under the brief filter chrome. Nothing is being
searched, so the filter sheet has the row — typing hands it to the results.`,...u.parameters?.docs?.description}}};b.parameters={...b.parameters,docs:{...b.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="asdfqwer" sections={emptySections} preset="brief" />
}`,...b.parameters?.docs?.source},description:{story:"A query that matches nothing.",...b.parameters?.docs?.description}}};g.parameters={...g.parameters,docs:{...g.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" loading preset="brief" />
}`,...g.parameters?.docs?.source},description:{story:"Results still loading.",...g.parameters?.docs?.description}}};f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" sections={[{
    id: "related",
    label: "Related",
    results: related
  }]} preset="brief" />
}`,...f.parameters?.docs?.source},description:{story:`Selecting a "Related" (semantic) hit. These rows carry their own thread +
mailbox, so tapping one opens the conversation directly — even though the
matching message lives outside the loaded list. Tap a row under "Related" to
see the thread + mailbox the result hands the app to open. Regression cover for
the brief bug where a tapped related result selected nothing.`,...f.parameters?.docs?.description}}};v.parameters={...v.parameters,docs:{...v.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" initialChips={[{
    id: "in:spam",
    label: "in:spam"
  }]} sections={[{
    id: "top",
    label: "Top matches",
    results: spamMatches
  }]} scope={{
    kind: "folder",
    role: "junk"
  }} preset="inbox" />
}`,...v.parameters?.docs?.source},description:{story:`The narrowing expression on mobile: the same \`SearchChipInput\` the desktop
top bar uses, inside the full-screen takeover's own chrome. The chip is
removable in place — backspace at the start of the text reaches it just as it
does on desktop.

The chip and the scope say the same thing, which is the point: an \`in:spam\`
chip is what a Spam-scoped search looks like in the bar.`,...v.parameters?.docs?.description}}};S.parameters={...S.parameters,docs:{...S.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" sections={acrossFoldersSections} scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} preset="brief" />
}`,...S.parameters?.docs?.source},description:{story:`Global search on the phone, holding spam out and offering it above the
results — the same treatment the desktop list pane gives it, because both
tiers render the one \`SearchResults\` body. Rows name the folder they came
from; the two spam matches in the same data are not among them.`,...S.parameters?.docs?.description}}};x.parameters={...x.parameters,docs:{...x.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" initialChips={[{
    id: "in:inbox",
    label: "in:inbox"
  }]} sections={acrossFoldersSections} scope={{
    kind: "folder",
    role: "inbox"
  }} preset="inbox" />
}`,...x.parameters?.docs?.source},description:{story:`The same rows scoped to the inbox. No spam, no count, no offer, and no
provenance labels — the chip in the bar already says where the search is
looking.`,...x.parameters?.docs?.description}}};y.parameters={...y.parameters,docs:{...y.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" sections={[{
    id: "top",
    label: "Top matches",
    results: spamMatches
  }]} scope={{
    kind: "global",
    onScopeToSpam: () => {}
  }} preset="brief" />
}`,...y.parameters?.docs?.source},description:{story:`A global phone search whose only matches are in Spam: the offer stands above
the empty state rather than leaving the search looking fruitless.`,...y.parameters?.docs?.description}}};k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  render: () => <Harness initialValue="invoice" initialChips={[{
    id: "is:starred",
    label: "is:starred"
  }]} sections={acrossFoldersSections} scope={{
    kind: "collection"
  }} preset="brief" />
}`,...k.parameters?.docs?.source},description:{story:`The same rows under a starred search. Starring spans folders, so the rows
keep their provenance labels, and the spam among them stays in the list — the
user starred it themselves, so there is nothing to hold back and no offer to
make.`,...k.parameters?.docs?.description}}};const We=["GlobalSearch","ScopedSearch","NothingToConvert","SuggestingFolders","Idle","NoResults","Loading","RelatedSelectable","ScopedByChip","GlobalAcrossFolders","ScopedToInbox","GlobalOnlySpamMatches","StarredCollection"];export{S as GlobalAcrossFolders,y as GlobalOnlySpamMatches,d as GlobalSearch,u as Idle,g as Loading,b as NoResults,h as NothingToConvert,f as RelatedSelectable,v as ScopedByChip,p as ScopedSearch,x as ScopedToInbox,k as StarredCollection,m as SuggestingFolders,We as __namedExportsOrder,Ke as default};
