import{j as e}from"./iframe-R-hq3KXP.js";import"./preload-helper-PPVm8Dsz.js";const h=(r,m)=>{const o=`${r} image${r>1?"s":""}`;return m?`${o} hidden — you blocked this sender`:`${o} blocked for privacy`},s=({blockedImageCount:r,canAlwaysTrust:m,isTrustPending:o,isSenderBlocked:p,onLoadOnce:y,onAlwaysTrust:b})=>e.jsxs("div",{"data-testid":"blocked-images-notice",className:"mb-3 flex items-center justify-between rounded-md bg-surface-sunken/50 px-3 py-2 text-sm",children:[e.jsx("span",{className:"text-fg-muted",children:h(r,p)}),!p&&e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("button",{type:"button",onClick:y,className:"text-accent hover:underline",children:"Load once"}),m&&e.jsx("button",{type:"button",onClick:b,"aria-busy":o,className:"text-accent hover:underline aria-busy:opacity-50",children:o?"Trusting…":"Always trust"})]})]});s.__docgenInfo={description:"",methods:[],displayName:"BlockedImagesNotice",props:{blockedImageCount:{required:!0,tsType:{name:"number"},description:""},canAlwaysTrust:{required:!0,tsType:{name:"boolean"},description:""},isTrustPending:{required:!0,tsType:{name:"boolean"},description:""},isSenderBlocked:{required:!0,tsType:{name:"boolean"},description:`The From-address carries the \`blocked\` flag. Blocking is a stronger
instruction than "not trusted": images never load, "even on explicit
click", so the bar states why the message is image-free instead of
offering a way past it. The affordances are absent, never disabled — a
dead button reads as broken (#943).`},onLoadOnce:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},onAlwaysTrust:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""}}};const x={title:"Flows/Mail/Blocked Images Notice",component:s,parameters:{layout:"padded",docs:{description:{component:`The bar above a message body whose remote images were not loaded.

Two different facts wear the same strip. Images held back for privacy are a
default the reader can lift, so the bar offers both ways out and neither
control ever greys out. A blocked sender is an instruction the reader already
gave — \`BlockedFlag\`: never load images, even on explicit click — so the bar
carries no controls at all and says why instead, because an image-free
message that explains nothing is indistinguishable from a broken one.`}}}},g=()=>{},n={blockedImageCount:3,canAlwaysTrust:!0,isTrustPending:!1,isSenderBlocked:!1,onLoadOnce:g,onAlwaysTrust:g},a=({children:r})=>e.jsx("div",{className:"w-full max-w-2xl",children:r}),t={render:()=>e.jsx(a,{children:e.jsx(s,{...n})})},d={render:()=>e.jsx(a,{children:e.jsx(s,{...n,isTrustPending:!0})})},c={render:()=>e.jsx(a,{children:e.jsx(s,{...n,canAlwaysTrust:!1})})},i={render:()=>e.jsx(a,{children:e.jsx(s,{...n,isSenderBlocked:!0})})},l={render:()=>e.jsx(a,{children:e.jsx(s,{...n,isSenderBlocked:!0,canAlwaysTrust:!0})})},u={render:()=>e.jsx(a,{children:e.jsx(s,{...n,blockedImageCount:1})})};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} />
        </Column>
}`,...t.parameters?.docs?.source},description:{story:"The default: images held back, and two ways to let them in.",...t.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} isTrustPending />
        </Column>
}`,...d.parameters?.docs?.source},description:{story:"The trust toggle is in flight. The button stays pressable and says so.",...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} canAlwaysTrust={false} />
        </Column>
}`,...c.parameters?.docs?.source},description:{story:"No parseable From-address, so there is nobody to trust — only Load once.",...c.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} isSenderBlocked />
        </Column>
}`,...i.parameters?.docs?.source},description:{story:"A blocked sender: no way in, and the reason stated rather than left blank.",...i.parameters?.docs?.description}}};l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} isSenderBlocked canAlwaysTrust />
        </Column>
}`,...l.parameters?.docs?.source},description:{story:"Blocked outranks trusted — a sender carrying both is still blocked.",...l.parameters?.docs?.description}}};u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  render: () => <Column>
            <BlockedImagesNotice {...base} blockedImageCount={1} />
        </Column>
}`,...u.parameters?.docs?.source},description:{story:"One image, and the copy counts it as one.",...u.parameters?.docs?.description}}};const T=["Privacy","Trusting","NoSenderToTrust","SenderBlocked","SenderBlockedAndTrusted","SingleImage"];export{c as NoSenderToTrust,t as Privacy,i as SenderBlocked,l as SenderBlockedAndTrusted,u as SingleImage,d as Trusting,T as __namedExportsOrder,x as default};
