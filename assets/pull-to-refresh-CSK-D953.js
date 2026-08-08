import{R as l,r as d,j as $}from"./iframe-zw88L4Mq.js";var w;(function(e){e[e.UP=-1]="UP",e[e.DOWN=1]="DOWN"})(w||(w={}));function K(e){var t=getComputedStyle(e).overflowY;return e===document.scrollingElement&&t==="visible"?!0:!(t!=="scroll"&&t!=="auto")}function I(e,t){if(!K(e))return!1;if(t===w.DOWN){var a=e.scrollTop+e.clientHeight;return a<e.scrollHeight}if(t===w.UP)return e.scrollTop>0;throw new Error("unsupported direction")}function H(e,t){return I(e,t)?!0:e.parentElement==null?!1:H(e.parentElement,t)}function j(e,t){t===void 0&&(t={});var a=t.insertAt;if(!(!e||typeof document>"u")){var s=document.head||document.getElementsByTagName("head")[0],i=document.createElement("style");i.type="text/css",a==="top"&&s.firstChild?s.insertBefore(i,s.firstChild):s.appendChild(i),i.styleSheet?i.styleSheet.cssText=e:i.appendChild(document.createTextNode(e))}}var Q=`.lds-ellipsis {
  display: inline-block;
  position: relative;
  width: 64px;
  height: 64px;
}

.lds-ellipsis div {
  position: absolute;
  top: 27px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: rgb(54, 54, 54);
  animation-timing-function: cubic-bezier(0, 1, 1, 0);
}

.lds-ellipsis div:nth-child(1) {
  left: 6px;
  animation: lds-ellipsis1 0.6s infinite;
}

.lds-ellipsis div:nth-child(2) {
  left: 6px;
  animation: lds-ellipsis2 0.6s infinite;
}

.lds-ellipsis div:nth-child(3) {
  left: 26px;
  animation: lds-ellipsis2 0.6s infinite;
}

.lds-ellipsis div:nth-child(4) {
  left: 45px;
  animation: lds-ellipsis3 0.6s infinite;
}

@keyframes lds-ellipsis1 {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes lds-ellipsis3 {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(0);
  }
}
@keyframes lds-ellipsis2 {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(19px, 0);
  }
}`;j(Q);var V=function(){return l.createElement("div",{className:"lds-ellipsis"},l.createElement("div",null),l.createElement("div",null),l.createElement("div",null),l.createElement("div",null))},X=function(){return l.createElement("div",null,l.createElement("p",null,"↧  pull to refresh  ↧"))},G=`.ptr,
.ptr__children {
  height: 100%;
  width: 100%;
  overflow: hidden;
  -webkit-overflow-scrolling: touch;
  position: relative;
}

.ptr.ptr--fetch-more-treshold-breached .ptr__fetch-more {
  display: block;
}

.ptr__fetch-more {
  display: none;
}

/**
  * Pull down transition 
  */
.ptr__children,
.ptr__pull-down {
  transition: transform 0.2s cubic-bezier(0, 0, 0.31, 1);
}

.ptr__pull-down {
  position: absolute;
  overflow: hidden;
  left: 0;
  right: 0;
  top: 0;
  visibility: hidden;
}
.ptr__pull-down > div {
  display: none;
}

.ptr--dragging {
  /**
    * Hide PullMore content is treshold breached
    */
}
.ptr--dragging.ptr--pull-down-treshold-breached .ptr__pull-down--pull-more {
  display: none;
}
.ptr--dragging {
  /**
    * Otherwize, display content
    */
}
.ptr--dragging .ptr__pull-down--pull-more {
  display: block;
}

.ptr--pull-down-treshold-breached {
  /**
    * Force opacity to 1 is pull down trashold breached
    */
}
.ptr--pull-down-treshold-breached .ptr__pull-down {
  opacity: 1 !important;
}
.ptr--pull-down-treshold-breached {
  /**
    * And display loader
    */
}
.ptr--pull-down-treshold-breached .ptr__pull-down--loading {
  display: block;
}

.ptr__loader {
  margin: 0 auto;
  text-align: center;
}`;j(G);var J=function(e){var t=e.isPullable,a=t===void 0?!0:t,s=e.canFetchMore,i=s===void 0?!1:s,E=e.onRefresh,b=e.onFetchMore,P=e.refreshingContent,k=P===void 0?l.createElement(V,null):P,D=e.pullingContent,O=D===void 0?l.createElement(X,null):D,L=e.children,C=e.pullDownThreshold,x=C===void 0?67:C,N=e.fetchMoreThreshold,R=N===void 0?100:N,S=e.maxPullDownDistance,M=S===void 0?95:S,A=e.resistance,U=A===void 0?1:A,W=e.backgroundColor,Y=e.className,q=Y===void 0?"":Y,o=d.useRef(null),r=d.useRef(null),u=d.useRef(null),z=d.useRef(null),y=!1,g=!1,h=!1,f=0,v=0;d.useEffect(function(){if(!(!a||!r||!r.current)){var n=r.current;return n.addEventListener("touchstart",_,{passive:!0}),n.addEventListener("mousedown",_),n.addEventListener("touchmove",T,{passive:!1}),n.addEventListener("mousemove",T),window.addEventListener("scroll",F),n.addEventListener("touchend",m),n.addEventListener("mouseup",m),document.body.addEventListener("mouseleave",m),function(){n.removeEventListener("touchstart",_),n.removeEventListener("mousedown",_),n.removeEventListener("touchmove",T),n.removeEventListener("mousemove",T),window.removeEventListener("scroll",F),n.removeEventListener("touchend",m),n.removeEventListener("mouseup",m),document.body.removeEventListener("mouseleave",m)}}},[L,a,E,x,M,i,R]),d.useEffect(function(){var n;if(!((n=o)===null||n===void 0)&&n.current){var c=o.current.classList.contains("ptr--fetch-more-treshold-breached");c||i&&B()<R&&b&&(o.current.classList.add("ptr--fetch-more-treshold-breached"),g=!0,b().then(p).catch(p))}},[i,L]);var B=function(){if(!r||!r.current)return-1;var n=window.scrollY,c=r.current.scrollHeight;return c-n-window.innerHeight},p=function(){requestAnimationFrame(function(){r.current&&(r.current.style.overflowX="hidden",r.current.style.overflowY="auto",r.current.style.transform="unset"),u.current&&(u.current.style.opacity="0"),o.current&&(o.current.classList.remove("ptr--pull-down-treshold-breached"),o.current.classList.remove("ptr--dragging"),o.current.classList.remove("ptr--fetch-more-treshold-breached")),y&&(y=!1),g&&(g=!1)})},_=function(n){h=!1,n instanceof MouseEvent&&(f=n.pageY),window.TouchEvent&&n instanceof TouchEvent&&(f=n.touches[0].pageY),v=f,!(n.type==="touchstart"&&H(n.target,w.UP))&&(r.current.getBoundingClientRect().top<0||(h=!0))},T=function(n){if(h){if(window.TouchEvent&&n instanceof TouchEvent?v=n.touches[0].pageY:v=n.pageY,o.current.classList.add("ptr--dragging"),v<f){h=!1;return}n.cancelable&&n.preventDefault();var c=Math.min((v-f)/U,M);c>=x&&(h=!0,y=!0,o.current.classList.remove("ptr--dragging"),o.current.classList.add("ptr--pull-down-treshold-breached")),!(c>=M)&&(u.current.style.opacity=(c/65).toString(),r.current.style.overflow="visible",r.current.style.transform="translate(0px, "+c+"px)",u.current.style.visibility="visible")}},F=function(n){g||i&&B()<R&&b&&(g=!0,o.current.classList.add("ptr--fetch-more-treshold-breached"),b().then(p).catch(p))},m=function(){if(h=!1,f=0,v=0,!y){u.current&&(u.current.style.visibility="hidden"),p();return}r.current&&(r.current.style.overflow="visible",r.current.style.transform="translate(0px, "+x+"px)"),E().then(p).catch(p)};return l.createElement("div",{className:"ptr "+q,style:{backgroundColor:W},ref:o},l.createElement("div",{className:"ptr__pull-down",ref:u},l.createElement("div",{className:"ptr__loader ptr__pull-down--loading"},k),l.createElement("div",{className:"ptr__pull-down--pull-more"},O)),l.createElement("div",{className:"ptr__children",ref:r},L,l.createElement("div",{className:"ptr__fetch-more",ref:z},l.createElement("div",{className:"ptr__loader ptr__fetch-more--loading"},k))))};const Z=1024,ee=`(min-width: ${Z}px) and (not ((orientation: portrait) and (pointer: coarse)))`,ne=e=>{const[t,a]=d.useState(()=>typeof window>"u"||!window.matchMedia?!1:window.matchMedia(e).matches);return d.useEffect(()=>{if(typeof window>"u"||!window.matchMedia)return;const s=window.matchMedia(e);a(s.matches);const i=E=>a(E.matches);return s.addEventListener("change",i),()=>s.removeEventListener("change",i)},[e]),t},te=({children:e,onRefresh:t,isRefreshing:a})=>ne(ee)?e:$.jsx(J,{onRefresh:t,isPullable:!a,children:e});te.__docgenInfo={description:"Wraps a scrollable list with a pull-to-refresh gesture on mobile. Below the\ndesktop breakpoint (Tailwind `lg`) a downward pull at the top of the list\nfires `onRefresh`; at desktop the gesture is inert and children render\ndirectly, since there is no touch list to pull.\n\nPresentational: the caller owns what refreshing means via `onRefresh` and\nsurfaces in-flight state through `isRefreshing`.",methods:[],displayName:"PullToRefresh",props:{children:{required:!0,tsType:{name:"ReactElement"},description:""},onRefresh:{required:!0,tsType:{name:"signature",type:"function",raw:"() => Promise<unknown>",signature:{arguments:[],return:{name:"Promise",elements:[{name:"unknown"}],raw:"Promise<unknown>"}}},description:""},isRefreshing:{required:!1,tsType:{name:"boolean"},description:""}}};export{te as P};
