import{r as o,j as g}from"./iframe-uTafckjr.js";const N='"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',M={light:{fg:"oklch(0.3 0.025 235)",surface:"oklch(0.975 0.012 90)",accent:"oklch(0.55 0.14 150)"},dark:{fg:"oklch(0.88 0.02 90)",surface:"oklch(0.25 0.025 220)",accent:"oklch(0.78 0.16 150)"}},O=/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i,S='<meta name="viewport" content="width=device-width, initial-scale=1">',K=e=>{const t=e?M.dark:M.light;return`
/* Plain-email base: UI font-stack + theme-aware colors (#424) */
html, body {
  font-family: ${N};
  font-size: 14px;
  line-height: 1.6;
  color: ${t.fg};
  background-color: ${t.surface};
  margin: 0;
  padding: 0;
}
/* Strip author unreadable text colors and element backgrounds, scoped to body
   descendants so the themed html/body surface above survives this reset. */
body * {
  color: inherit !important;
  background-color: transparent !important;
}
a, a:visited {
  color: ${t.accent} !important;
  text-decoration: underline;
}
`},z=(e,t)=>e?t?"html,body{margin:0;color-scheme:dark light}":"html{margin:0;background-color:#ffffff;filter:invert(0.92) hue-rotate(180deg)}body{margin:0}img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:invert(0.92) hue-rotate(180deg)}":"html,body{margin:0;background-color:#ffffff;color-scheme:light}",W=(e,t,n)=>{if(t==="plain")return`${S}<style>${K(n)}</style>${e}`;const s=O.test(e);return`${S}<style>${z(n,s)}</style>${e}`},P=5e4,C=1e4,F="(max-width: 640px)",j=.4,V="allow-same-origin allow-popups allow-popups-to-escape-sandbox",T=(e,t,n)=>Math.min(Math.ceil(Math.max(e,t)),n),U=(e,t)=>e<=0||t<=0||e<=t?1:Math.max(j,t/e),X=e=>{const[t,n]=o.useState(()=>typeof window>"u"||!window.matchMedia?!1:window.matchMedia(e).matches);return o.useEffect(()=>{if(typeof window>"u"||!window.matchMedia)return;const s=window.matchMedia(e);n(s.matches);const l=f=>n(f.matches);return s.addEventListener("change",l),()=>s.removeEventListener("change",l)},[e]),t},B=new Set(["Enter","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"]),q=e=>e===" "?!1:e.length===1?!0:B.has(e),R=e=>{if(e.metaKey||e.ctrlKey||e.altKey||!q(e.key))return;const t=e.currentTarget??e.target,n=t?.defaultView?.parent;!n||n===t?.defaultView||n.dispatchEvent(new KeyboardEvent("keydown",{key:e.key,code:e.code,shiftKey:e.shiftKey,bubbles:!0,cancelable:!0}))},G=({html:e,variant:t="framed",isDark:n=!1,className:s})=>{const l=o.useRef(null),f=o.useRef(null),[p,A]=o.useState(0),[d,_]=o.useState(0),[$,D]=o.useState(0),b=X(F),I=o.useMemo(()=>W(e,t,n),[e,t,n]);o.useEffect(()=>{const a=l.current;if(!a)return;const m=()=>D(h=>h===a.clientWidth?h:a.clientWidth);m();const c=new ResizeObserver(m);return c.observe(a),()=>c.disconnect()},[]),o.useEffect(()=>{const a=f.current;if(!a)return;const m=()=>{const r=a.contentDocument;if(!r?.body)return;const k=r.documentElement,E=T(r.body.scrollHeight,k?.scrollHeight??0,P);A(u=>u===E?u:E);const x=T(r.body.scrollWidth,k?.scrollWidth??0,C);_(u=>u===x?u:x)};let c,h;const v=()=>{m();const r=a.contentDocument;r?.body&&(c=new ResizeObserver(m),c.observe(r.body),r.documentElement&&c.observe(r.documentElement),r.addEventListener("keydown",R),h=r)};return a.addEventListener("load",v),()=>{a.removeEventListener("load",v),h?.removeEventListener("keydown",R),c?.disconnect()}},[]);const w=b?U(d,$):1,i=w<1,L=i?`${d}px`:b?"100%":t==="framed"&&d>0?`max(100%, ${d}px)`:d===0?"100%":`${d}px`,H=p===0?"1px":`${p}px`,y=g.jsx("iframe",{ref:f,title:"Email content",sandbox:V,srcDoc:I,className:i?void 0:s,scrolling:"no",style:{width:L,maxWidth:i?"none":void 0,border:"none",display:"block",height:H,overflow:"hidden",transform:i?`scale(${w})`:void 0,transformOrigin:i?"top left":void 0,colorScheme:"normal"}});return g.jsx("div",{ref:l,className:i?s:void 0,children:i?g.jsx("div",{style:{width:"100%",height:`${Math.ceil(p*w)}px`,overflow:"hidden"},children:y}):y})};G.__docgenInfo={description:`Render untrusted (sanitized) email HTML in a sandboxed iframe that fits the
viewport width on mobile and isolates the email's CSS from the app chrome.

Presentational: HTML + treatment + theme come in via props; the component
owns the srcDoc assembly, the content-sizing, and the fit-to-viewport
decision in one place. The frame sizes itself to its content via a
ResizeObserver so it grows no internal scrollbars — vertical scrolling and
(on desktop) horizontal scrolling of genuinely wide email are delegated to
the surrounding pane.

On a phone a fixed-layout email that *can't* reflow (an inline
\`min-width:600px\` on a \`<td>\` beats the sanitizer's clamp) is rendered at its
natural width and the whole iframe is CSS-scaled down to fit the container —
the email stays whole and readable instead of being clipped (#727).`,methods:[],displayName:"IsolatedEmailFrame",props:{html:{required:!0,tsType:{name:"string"},description:`Sanitized email HTML. Must already be DOMPurify'd and carry the
sanitizer's layout-clamp \`<style>\` block; this component only adds the
colour / font / dark-mode canvas and isolates the result in a sandboxed
iframe. Never pass raw, untrusted HTML here.`},variant:{required:!1,tsType:{name:"union",raw:'"plain" | "framed"',elements:[{name:"literal",value:'"plain"'},{name:"literal",value:'"framed"'}]},description:`Render treatment:

- \`"plain"\` — weakly-marked / personal mail. UI sans-serif + theme-aware
  colours are injected so black-text-on-dark is readable.
- \`"framed"\` — designed mail (newsletter / marketing / author background).
  The author's colours are preserved; in dark mode the email is darkened
  via a smart-invert unless it opts into its own dark design.`,defaultValue:{value:'"framed"',computed:!1}},isDark:{required:!1,tsType:{name:"boolean"},description:`Whether the app is in dark mode. The plain branch picks theme-aware
colours; the framed branch decides whether to render as-authored on white
or apply the smart-invert.`,defaultValue:{value:"false",computed:!1}},className:{required:!1,tsType:{name:"string"},description:""}}};export{G as I};
