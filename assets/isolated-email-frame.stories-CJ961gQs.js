import{j as d}from"./iframe-zw88L4Mq.js";import{I as w}from"./isolated-email-frame-UJHBshTb.js";import"./preload-helper-PPVm8Dsz.js";const p=`<style>
html, body { margin: 0; padding: 0; max-width: 100%; }
body { overflow-wrap: anywhere; word-break: break-word; }
img, video, iframe, svg, canvas { max-width: 100% !important; height: auto; }
table { max-width: 100% !important; table-layout: auto; }
td, th { max-width: 100% !important; }
* { min-width: 0; }
pre, code { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
</style>`,k=`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
        <rect width="600" height="200" fill="#1d1d2b"/>
        <circle cx="300" cy="100" r="60" fill="#e23a78"/>
    </svg>`)}`,h=`${p}
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
            <p>https://nodejs.example/blog/release/v24.0.0-this-is-a-deliberately-very-long-unbroken-url-to-prove-wrapping</p>
            <p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
        </td>
    </tr>
</table>
`,f=`${p}
<div style="font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; width: 600px; max-width: 600px;">
    <img src="${k}" alt="Hero" width="600" style="display:block;width:100%;height:auto;" />
    <div style="padding: 20px;">
        <h1 style="font-size: 22px; margin: 0 0 8px;">Bespaar op je energierekening</h1>
        <p style="margin: 0 0 16px; line-height: 1.5;">Vergelijk vandaag nog alle
        energieleveranciers en stap eenvoudig over. Onze klanten besparen gemiddeld
        honderden euro's per jaar.</p>
        <a href="https://example.com" style="display:inline-block;background:#e23a78;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;">Vergelijk nu</a>
    </div>
</div>
`,g=`${p}
<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h1 style="font-size: 24px; margin: 0 0 4px;">The Weekly Dispatch</h1>
    <p style="color: #666; margin: 0 0 24px;">June 2026</p>
    <p>This is a fluid newsletter with a 640px max-width body. On desktop it fills
    the reading column; on a phone it reflows to the viewport with no horizontal
    scroll.</p>
    <p><a href="https://example.com" style="color: #268bd2;">Read online &rarr;</a></p>
</div>
`,u=`${p}
<div style="color:#000">
    <p>Hi there,</p>
    <p>Just confirming our call for tomorrow at 10am. Let me know if that still
    works for you.</p>
    <p>Thanks,<br>Alex</p>
</div>
`,m=c=>d.jsx("div",{className:"overflow-x-auto",style:{width:390},children:d.jsx(c,{})}),l=c=>d.jsx("div",{className:"overflow-x-auto",style:{width:720},children:d.jsx(c,{})}),b={title:"Components/IsolatedEmailFrame",component:w,parameters:{layout:"fullscreen"},argTypes:{variant:{control:"inline-radio",options:["plain","framed"]},isDark:{control:"boolean"}}},e={args:{html:h,variant:"framed",isDark:!1},decorators:[m]},a={args:{html:h,variant:"framed",isDark:!1},decorators:[l]},r={args:{html:f,variant:"framed",isDark:!1},decorators:[m]},t={args:{html:g,variant:"framed",isDark:!1},decorators:[l]},s={args:{html:g,variant:"framed",isDark:!1},decorators:[m]},o={args:{html:f,variant:"framed",isDark:!0},parameters:{theme:"dark"},decorators:[l]},n={args:{html:u,variant:"plain",isDark:!1},decorators:[l]},i={args:{html:u,variant:"plain",isDark:!0},parameters:{theme:"dark"},decorators:[l]};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    html: NODE_WEEKLY,
    variant: "framed",
    isDark: false
  },
  decorators: [PHONE]
}`,...e.parameters?.docs?.source},description:{story:"#727: a 600px fixed-width Node Weekly table at a 390px phone width. The inline\n `min-width:600px` on the `<td>` beats the clamp so the table can't collapse;\n the frame scales the whole email down to fit the box WHOLE, with no clipping\n and no horizontal page scroll.",...e.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  args: {
    html: NODE_WEEKLY,
    variant: "framed",
    isDark: false
  },
  decorators: [COLUMN]
}`,...a.parameters?.docs?.source},description:{story:"The same Node Weekly newsletter on a desktop reading column.",...a.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    html: GASLICHT,
    variant: "framed",
    isDark: false
  },
  decorators: [PHONE]
}`,...r.parameters?.docs?.source},description:{story:`Gaslicht.com-style 600px fixed-width marketing mail at phone width: the hero
 image and CTA scale down with the frame to fit the phone whole.`,...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    html: SUBSTACK,
    variant: "framed",
    isDark: false
  },
  decorators: [COLUMN]
}`,...t.parameters?.docs?.source},description:{story:"Substack-style fluid newsletter on a desktop column: fills the reading\n width via the framed `max(100%, content)` path.",...t.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  args: {
    html: SUBSTACK,
    variant: "framed",
    isDark: false
  },
  decorators: [PHONE]
}`,...s.parameters?.docs?.source},description:{story:"Substack fluid newsletter reflowed to a phone width.",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    html: GASLICHT,
    variant: "framed",
    isDark: true
  },
  parameters: {
    theme: "dark"
  },
  decorators: [COLUMN]
}`,...o.parameters?.docs?.source},description:{story:`Framed newsletter on the DARK reading pane: smart-inverted to charcoal with
 the hero re-inverted back to natural color.`,...o.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  args: {
    html: PLAIN,
    variant: "plain",
    isDark: false
  },
  decorators: [COLUMN]
}`,...n.parameters?.docs?.source},description:{story:`Plain personal email: UI font-stack + theme-aware colors injected so the
 black-on-white author text stays readable in either theme.`,...n.parameters?.docs?.description}}};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  args: {
    html: PLAIN,
    variant: "plain",
    isDark: true
  },
  parameters: {
    theme: "dark"
  },
  decorators: [COLUMN]
}`,...i.parameters?.docs?.source},description:{story:`Plain email in dark mode: must be light text on the dark surface, never
 black-on-dark.`,...i.parameters?.docs?.description}}};const D=["NodeWeeklyMobile","NodeWeeklyDesktop","GaslichtMobile","SubstackDesktop","SubstackMobile","NewsletterDarkPane","PlainEmail","PlainEmailDark"];export{r as GaslichtMobile,o as NewsletterDarkPane,a as NodeWeeklyDesktop,e as NodeWeeklyMobile,n as PlainEmail,i as PlainEmailDark,t as SubstackDesktop,s as SubstackMobile,D as __namedExportsOrder,b as default};
