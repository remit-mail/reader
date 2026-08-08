import{j as l}from"./iframe-uTafckjr.js";import{M as h}from"./message-body-view-DHaA5vsN.js";import"./preload-helper-PPVm8Dsz.js";import"./cn-BnS_VibS.js";import"./bundle-mjs-DeRmtv56.js";import"./purify.es-2FREwzWT.js";import"./isolated-email-frame-C3dalT56.js";const m=`
<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
    <tr>
        <td width="600" style="width:600px;min-width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
            <h1 style="margin:0;font-size:26px;">Node Weekly</h1>
            <p style="margin:4px 0 0;font-size:14px;">Issue 540 — June 18, 2026</p>
        </td>
    </tr>
    <tr>
        <td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
            <h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
            <p>The release line is now Active LTS. The permission model graduated
            from experimental, and the built-in test runner picked up snapshot
            testing — all without a single dependency.</p>
            <p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
        </td>
    </tr>
</table>
`,p=`
<div style="color:#000">
    <p>Hi there,</p>
    <p>Just confirming our call for tomorrow at 10am. Let me know if that still
    works for you.</p>
    <p>Thanks,<br>Alex</p>
</div>
`,g=`
<div style="font-family: Helvetica, Arial, sans-serif; background:#ffffff; color:#1a1a1a; padding:20px;">
    <img src="https://tracker.example/hero.png" alt="Hero" width="560" />
    <h1 style="font-size:22px;">Summer sale</h1>
    <p>Up to 40% off everything this weekend.</p>
    <img src="https://tracker.example/footer.png" alt="Footer" width="560" />
</div>
`,e=r=>l.jsx("div",{style:{width:720},children:l.jsx(r,{})}),u=r=>l.jsx("div",{style:{width:390},children:l.jsx(r,{})}),E={title:"Components/MessageBodyView",component:h,parameters:{layout:"padded"},argTypes:{isDark:{control:"boolean"},allowImages:{control:"boolean"}}},t={args:{html:m,category:"newsletter",allowImages:!0},decorators:[e]},a={args:{html:m,category:"newsletter",allowImages:!0},decorators:[u]},s={args:{html:m,category:"newsletter",allowImages:!0,isDark:!0},parameters:{theme:"dark"},decorators:[e]},o={args:{html:p,category:"personal",allowImages:!0},decorators:[e]},n={args:{html:p,category:"personal",allowImages:!0,isDark:!0},parameters:{theme:"dark"},decorators:[e]},i={args:{html:g,category:"marketing",allowImages:!1,renderBlockedNotice:r=>l.jsxs("div",{className:"mb-3 rounded-md bg-surface-sunken/50 px-3 py-2 text-sm text-fg-muted",children:[r," image",r>1?"s":""," blocked for privacy"]})},decorators:[e]},c={args:{html:g,category:"marketing",allowImages:!0},decorators:[e]},d={args:{html:void 0,text:void 0},decorators:[e]};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    html: NODE_WEEKLY,
    category: "newsletter",
    allowImages: true
  },
  decorators: [COLUMN]
}`,...t.parameters?.docs?.source},description:{story:`A fixed-width newsletter rendered through the real pipeline: sanitized,
 classified framed, rendered in the sandboxed frame.`,...t.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    html: NODE_WEEKLY,
    category: "newsletter",
    allowImages: true
  },
  decorators: [PHONE]
}`,...a.parameters?.docs?.source},description:{story:"The same newsletter on a phone width — #727 scale-to-fit keeps it whole.",...a.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    html: NODE_WEEKLY,
    category: "newsletter",
    allowImages: true,
    isDark: true
  },
  parameters: {
    theme: "dark"
  },
  decorators: [COLUMN]
}`,...s.parameters?.docs?.source},description:{story:"Newsletter on the dark reading pane: smart-inverted to charcoal.",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    html: PLAIN,
    category: "personal",
    allowImages: true
  },
  decorators: [COLUMN]
}`,...o.parameters?.docs?.source},description:{story:"Plain personal mail: UI font-stack + theme-aware colors injected.",...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    html: PLAIN,
    category: "personal",
    allowImages: true,
    isDark: true
  },
  parameters: {
    theme: "dark"
  },
  decorators: [COLUMN]
}`,...n.parameters?.docs?.source},description:{story:"Plain mail in dark mode: light text on the dark surface, never black-on-dark.",...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    html: WITH_REMOTE_IMAGES,
    category: "marketing",
    allowImages: false,
    renderBlockedNotice: count => <div className="mb-3 rounded-md bg-surface-sunken/50 px-3 py-2 text-sm text-fg-muted">
                {count} image{count > 1 ? "s" : ""} blocked for privacy
            </div>
  },
  decorators: [COLUMN]
}`,...i.parameters?.docs?.source},description:{story:"Images blocked: the sanitizer swaps remote images for placeholders and the\n privacy notice reports the count via `renderBlockedNotice`.",...i.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  args: {
    html: WITH_REMOTE_IMAGES,
    category: "marketing",
    allowImages: true
  },
  decorators: [COLUMN]
}`,...c.parameters?.docs?.source},description:{story:"Same mail with images loaded — the remote images render and no notice shows.",...c.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    html: undefined,
    text: undefined
  },
  decorators: [COLUMN]
}`,...d.parameters?.docs?.source},description:{story:"No body content: the empty-state fallback.",...d.parameters?.docs?.description}}};const b=["Newsletter","NewsletterMobile","NewsletterDark","Plain","PlainDark","ImagesBlocked","ImagesLoaded","Empty"];export{d as Empty,i as ImagesBlocked,c as ImagesLoaded,t as Newsletter,s as NewsletterDark,a as NewsletterMobile,o as Plain,n as PlainDark,b as __namedExportsOrder,E as default};
