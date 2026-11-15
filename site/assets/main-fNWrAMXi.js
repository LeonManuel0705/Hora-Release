import{l as q}from"./luna-C-uxyhUc.js";const j=JSON.parse(document.getElementById("content").textContent),ga={de:j.i18n_de||{},en:j.i18n_en||{}},va=new Set;var Xa;const E=((Xa=j.company)==null?void 0:Xa.name)||"";var Ka;const oa=((Ka=j.company)==null?void 0:Ka.repository)||"";var Wa;(Wa=j.company)!=null&&Wa.website;var Za;const La=((Za=j.company)==null?void 0:Za.websiteHost)||"";var Ga;const ta=((Ga=j.company)==null?void 0:Ga.email)||"";function ge(){try{const a=localStorage.getItem("lang");return a==="de"||a==="en"?a:null}catch{return null}}let U=ge()||"de";document.documentElement.lang=U;function Ca(a,e){let t=a;for(const s of e.split("."))t=t==null?void 0:t[s];return t}function G(){return U}function $(a){const e=Ca(ga[U],a);return e!==void 0?e:Ca(ga.de,a)}function c(a,e){let t=$(a);return typeof t!="string"?t===void 0?a:t:(e&&(t=t.replace(/\{(\w+)\}/g,(s,o)=>e[o]!==void 0?e[o]:s)),t)}const n=a=>String(a).replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]);function ve(a){if(!(a===U||!ga[a])){U=a,document.documentElement.lang=a;try{localStorage.setItem("lang",a)}catch{}va.forEach(e=>e(a))}}function $e(a){return va.add(a),()=>va.delete(a)}function Qa(a=document){a.querySelectorAll("[data-i18n]").forEach(e=>{e.textContent=c(e.dataset.i18n)}),a.querySelectorAll("[data-i18n-aria]").forEach(e=>{e.setAttribute("aria-label",c(e.dataset.i18nAria))})}const A=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;function Ja(a){const e=[...a.querySelectorAll("[data-reveal]")];if(!e.length)return()=>{};if(A()||!("IntersectionObserver"in window))return e.forEach(s=>s.classList.add("is-in")),()=>{};const t=new IntersectionObserver(s=>{for(const o of s)o.isIntersecting&&(o.target.classList.add("is-in"),t.unobserve(o.target))},{rootMargin:"0px 0px -8% 0px",threshold:.12});return e.forEach(s=>t.observe(s)),()=>t.disconnect()}function be(){const a=(e,t)=>`<li><a href="${e}">${n(c(t))}</a></li>`;return`<div class="footer-sign wrap">
    <a class="brand brand-footer" href="/" aria-label="${n(E)}">
      <svg class="brand-mark" viewBox="14 18 72 66" aria-hidden="true" focusable="false">
        <circle class="bm-sun" cx="40" cy="44" r="26" />
        <rect class="bm-tile" x="44" y="42" width="42" height="42" rx="12" />
        <path class="bm-overlap" d="M44 69.69V54A12 12 0 0 1 56 42H65.92A26 26 0 0 1 44 69.69Z" />
      </svg>
      <span class="brand-word">${n(E)}</span>
    </a>
    <p class="footer-sign-line">${n(c("footer.sign"))} <span data-version="full">${n(c("footer.version"))}</span></p>
    <nav class="footer-sign-nav" aria-label="${n(c("footer.nav_label"))}">
      <ul>
        ${a("/features","nav.features")}
        ${a("/privacy-philosophy","nav.privacy")}
        ${a("/download","nav.download_long")}
        ${a("/about","nav.about")}
        <li><a href="${oa}" rel="noopener" target="_blank">${n(c("footer.source"))}</a></li>
        <li><a href="mailto:${ta}">${n(c("footer.contact"))}</a></li>
        ${a("/nutzungsbedingungen","footer.terms")}
        ${a("/datenschutz","footer.privacy_policy")}
      </ul>
      <button class="lang-toggle lang-toggle-wide" type="button" data-lang-toggle>${n(c(`lang.name_${c("lang.other")}`))}</button>
    </nav>
  </div>`}let pa=null;function we(){return pa||(pa=fetch("/version.json",{cache:"no-cache"}).then(a=>a.ok?a.json():null).catch(()=>null)),pa}function _e(a){const e=a.querySelectorAll("[data-version]");e.length&&we().then(t=>{t&&e.forEach(s=>{const o=s.dataset.version;o==="full"&&t.versionName&&(s.textContent=`Version ${t.versionName}, Build ${t.buildNumber}.`),o==="short"&&t.version&&(s.textContent=`v${t.version}`)})})}const D="0.6.0",F=`${oa}/releases/download/v${D}`,za=`${E}-${D}-macOS.zip`,Ha=`${E}-Setup-${D}.exe`,Ta=`${E}-${D}.deb`,Ba=`${E}-${D}.AppImage`,ja=`${E}-${D}.apk`,z={macos:{id:"macos",name:"macOS",href:`${F}/${za}`,file:za,bytes:90200569,mark:"apple",kind:"zip"},windows:{id:"windows",name:"Windows",href:`${F}/${Ha}`,file:Ha,bytes:178027483,mark:"windows",kind:"exe"},linux:{id:"linux",name:"Linux",href:`${F}/${Ta}`,file:Ta,bytes:166994284,mark:"linux",kind:"deb",alt:{href:`${F}/${Ba}`,file:Ba,bytes:195768599}},android:{id:"android",name:"Android",href:`${F}/${ja}`,file:ja,bytes:106634694,mark:"android",kind:"apk"},ios:{id:"ios",name:"iPhone und iPad",nameEn:"iPhone and iPad",href:"/pwa/",file:null,bytes:0,mark:"apple",kind:"pwa"},web:{id:"web",name:"Browser",nameEn:"Browser",href:"/pwa/",file:null,bytes:0,mark:"globe",kind:"pwa"}},ae=["macos","windows","linux","android","ios","web"],Me=new Set(["macos","windows","linux","android"]),ee=()=>{var a;return/iPad/.test(navigator.userAgent||"")||/Mac/.test(((a=navigator.userAgentData)==null?void 0:a.platform)||navigator.platform||"")&&navigator.maxTouchPoints>1},te=(a,e)=>/Linux|X11/i.test(e)||/Linux/.test(a),ke=()=>navigator.maxTouchPoints>1||/arm|aarch/i.test(navigator.platform||"");function ca(){var s;const a=navigator.userAgent||"",e=((s=navigator.userAgentData)==null?void 0:s.platform)||"",t=e||navigator.platform||"";return/iPhone|iPod/.test(a)||ee()?"ios":/Android/i.test(a)||/Android/i.test(e)?"android":/CrOS/.test(a)||/Chrome ?OS/i.test(t)?"web":/Mac/i.test(t)||/Mac OS X/.test(a)?"macos":/Win/i.test(t)||/Windows/.test(a)?"windows":te(a,t)?ke()?null:"linux":null}function se(){var e;const a=ca();return a?[a]:te(navigator.userAgent||"",((e=navigator.userAgentData)==null?void 0:e.platform)||navigator.platform||"")?["android","linux"]:[]}function Ma(a){return a==="ios"?ee()?"iPad":"iPhone":a==="web"?"Chromebook":""}function B(a){return Math.round(a/1e6)}const $a=new Set;let ba=0,Ia=!1;function xe(){ba=0;const a=innerHeight;for(const e of $a)e.visible&&e.run(a)}function sa(){ba||(ba=requestAnimationFrame(xe))}function Ae(){Ia||(Ia=!0,addEventListener("scroll",sa,{passive:!0}),addEventListener("resize",sa,{passive:!0}))}const na=(a,e=0,t=1)=>Math.min(t,Math.max(e,a));function ne(a,e,t="25%"){if(!a)return()=>{};Ae();const s={visible:!1,run:l=>e(a.getBoundingClientRect(),l)},o=new IntersectionObserver(([l])=>{s.visible=l.isIntersecting,s.visible&&sa()},{rootMargin:`${t} 0px ${t} 0px`});return o.observe(a),$a.add(s),sa(),()=>{o.disconnect(),$a.delete(s)}}function Se(a,e=a){if(!a||!e)return()=>{};const t=[...a.querySelectorAll(".w")];if(A())return a.classList.add("is-lit"),()=>{};const s=4,o=new Array(t.length).fill(-1);return ne(e,(l,r)=>{const p=na((r*.15-l.top)/Math.max(1,l.height-r*1.05))*(t.length+s);for(let d=0;d<t.length;d++){const f=Math.round(na((p-d)/s)*100)/100;f!==o[d]&&(o[d]=f,t[d].style.opacity=(.24+.76*f).toFixed(2))}})}function Q(a,e){const t=[...a.querySelectorAll(e)];if(!t.length)return()=>{};if(A()||!("IntersectionObserver"in window))return t.forEach(o=>o.classList.add("is-in")),()=>{};const s=new IntersectionObserver(o=>{for(const l of o)l.isIntersecting&&(l.target.classList.add("is-in"),s.unobserve(l.target))},{rootMargin:"0px 0px -12% 0px",threshold:.15});return t.forEach(o=>s.observe(o)),()=>s.disconnect()}const Ee="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",qe="(max-width: 734px)",Le="(min-width: 735px)",oe=(a,e)=>`<picture><source media="${a}" srcset="${Ee}">${e}</picture>`;function la(a,{eager:e=!1,phone:t="",phoneAlt:s=""}={}){const o=a.map((r,i)=>{const p=`<img class="mac-shot${i===0?" is-on":""}" data-screen="${r.id}" src="/screens/${r.id}.webp" width="2880" height="1800" alt="${n(r.alt)}"${i===0?"":' aria-hidden="true"'} decoding="async"${e&&i===0?' fetchpriority="high"':' loading="lazy"'}>`;return t?oe(qe,p):p}).join(""),l=`<figure class="mac${t?" is-wide-only":""}">
    <div class="mac-lid">
      <span class="mac-cam" aria-hidden="true"></span>
      <div class="mac-screen">${o}</div>
    </div>
    <div class="mac-base" aria-hidden="true"><span class="mac-groove"></span></div>
  </figure>`;return t?l+V(`/screens/${t}.webp`,s||a[0].alt,{only:"phone",eager:e}):l}function V(a,e,{dark:t=!1,only:s="",eager:o=!1}={}){const l=o?' fetchpriority="high"':' loading="lazy"',r=i=>s==="phone"?oe(Le,i):i;return`<figure class="iphone${t?" is-dark":""}${s==="phone"?" is-phone-only":""}">
    <div class="iphone-body">
      <div class="iphone-screen">${r(`<img src="${a}" width="1170" height="2532" alt="${n(e)}"${l} decoding="async">`)}${r(`<img class="iphone-tabbar" src="${a}" width="1170" height="2532" alt=""${l} decoding="async">`)}</div>
      <span class="iphone-island" aria-hidden="true"></span>
    </div>
  </figure>`}function Ce(a,e){let t=!1;for(const s of a.querySelectorAll(".mac-shot")){const o=s.dataset.screen===e;t||(t=o),s.classList.toggle("is-on",o),o?s.removeAttribute("aria-hidden"):s.setAttribute("aria-hidden","true")}return t}/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ze=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const He=[["path",{d:"M5 12h14"}],["path",{d:"m12 5 7 7-7 7"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Te=[["path",{d:"M7 7h10v10"}],["path",{d:"M7 17 17 7"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Be=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M4.929 4.929 19.07 19.071"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const je=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{d:"M22 8c0-2.3-.8-4.3-2-6"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}],["path",{d:"M4 2C2.8 3.7 2 5.7 2 8"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ie=[["path",{d:"M12 5v16"}],["path",{d:"m16 12 2 2 4-4"}],["path",{d:"M22 6V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2h4.001A2 2 0 0022 17v-1.344"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Oe=[["path",{d:"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const De=[["path",{d:"M8 6v6"}],["path",{d:"M15 6v6"}],["path",{d:"M2 12h19.6"}],["path",{d:"M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"}],["circle",{cx:"7",cy:"18",r:"2"}],["path",{d:"M9 18h5"}],["circle",{cx:"16",cy:"18",r:"2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fe=[["path",{d:"M8 2v3"}],["path",{d:"M16 2v3"}],["rect",{x:"3",y:"3",width:"18",height:"18",rx:"2"}],["path",{d:"M3 9h18"}],["path",{d:"M8 13h.01"}],["path",{d:"M12 13h.01"}],["path",{d:"M16 13h.01"}],["path",{d:"M8 17h.01"}],["path",{d:"M12 17h.01"}],["path",{d:"M16 17h.01"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Re=[["path",{d:"M20 6 9 17l-5-5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ve=[["path",{d:"m6 9 6 6 6-6"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pe=[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335"}],["path",{d:"m9 11 3 3L22 4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ne=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{d:"M12 11h4"}],["path",{d:"M12 16h4"}],["path",{d:"M8 11h.01"}],["path",{d:"M8 16h.01"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ye=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 6v6h4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ue=[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78"}],["path",{d:"m2 2 20 20"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xe=[["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{d:"M16 14v6"}],["path",{d:"M8 14v6"}],["path",{d:"M12 16v6"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ke=[["path",{d:"M12 2v2"}],["path",{d:"m4.93 4.93 1.41 1.41"}],["path",{d:"M20 12h2"}],["path",{d:"m19.07 4.93-1.41 1.41"}],["path",{d:"M15.947 12.65a4 4 0 0 0-5.925-4.128"}],["path",{d:"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const We=[["path",{d:"m18 16 4-4-4-4"}],["path",{d:"m6 8-4 4 4 4"}],["path",{d:"m14.5 4-5 16"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ze=[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ge=[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3"}],["path",{d:"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{d:"M3 12A9 3 0 0 0 21 12"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qe=[["path",{d:"M12 15V3"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{d:"m7 10 5 5 5-5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Je=[["path",{d:"M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"}],["path",{d:"m2.5 21.5 1.4-1.4"}],["path",{d:"m20.1 3.9 1.4-1.4"}],["path",{d:"M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"}],["path",{d:"m9.6 14.4 4.8-4.8"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const at=[["circle",{cx:"12",cy:"12",r:"1"}],["circle",{cx:"19",cy:"12",r:"1"}],["circle",{cx:"5",cy:"12",r:"1"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const et=[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{d:"m2 2 20 20"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tt=[["path",{d:"M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"m5 16-3 3 3 3"}],["path",{d:"m9 22 3-3-3-3"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const st=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{d:"M10 9H8"}],["path",{d:"M16 13H8"}],["path",{d:"M16 17H8"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nt=[["path",{d:"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ot=[["path",{d:"M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"}],["path",{d:"M8 10v4"}],["path",{d:"M12 10v2"}],["path",{d:"M16 10v6"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ct=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{d:"M2 12h20"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lt=[["path",{d:"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"}],["path",{d:"M22 10v6"}],["path",{d:"M6 12.5V16a6 3 0 0 0 12 0v-3.5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rt=[["path",{d:"M10 16h.01"}],["path",{d:"M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}],["path",{d:"M21.946 12.013H2.054"}],["path",{d:"M6 16h.01"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const it=[["path",{d:"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pt=[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dt=[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 16v-4"}],["path",{d:"M12 8h.01"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ht=[["path",{d:"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ut=[["path",{d:"m5 8 6 6"}],["path",{d:"m4 14 6-6 2-3"}],["path",{d:"M2 5h12"}],["path",{d:"M7 2h1"}],["path",{d:"m22 22-5-10-5 10"}],["path",{d:"M14 18h6"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ft=[["path",{d:"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"}],["path",{d:"M20.054 15.987H3.946"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mt=[["rect",{width:"7",height:"9",x:"3",y:"3",rx:"1"}],["rect",{width:"7",height:"5",x:"14",y:"3",rx:"1"}],["rect",{width:"7",height:"9",x:"14",y:"12",rx:"1"}],["rect",{width:"7",height:"5",x:"3",y:"16",rx:"1"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yt=[["path",{d:"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{d:"M9 18h6"}],["path",{d:"M10 22h4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gt=[["path",{d:"M13 5h8"}],["path",{d:"M13 12h8"}],["path",{d:"M13 19h8"}],["path",{d:"m3 17 2 2 4-4"}],["path",{d:"m3 7 2 2 4-4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vt=[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $t=[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bt=[["path",{d:"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{cx:"12",cy:"10",r:"3"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wt=[["path",{d:"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _t=[["path",{d:"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"}],["path",{d:"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mt=[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kt=[["path",{d:"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xt=[["path",{d:"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"}],["path",{d:"M2 6h4"}],["path",{d:"M2 10h4"}],["path",{d:"M2 14h4"}],["path",{d:"M2 18h4"}],["path",{d:"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const At=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{d:"m15 5 4 4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const St=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{d:"M8 16H3v5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Et=[["path",{d:"M12 3v18"}],["path",{d:"m19 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{d:"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"}],["path",{d:"m5 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{d:"M7 21h10"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qt=[["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3"}],["path",{d:"M18 4.933V21"}],["path",{d:"m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6"}],["path",{d:"m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"}],["path",{d:"M6 4.933V21"}],["circle",{cx:"12",cy:"9",r:"2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lt=[["path",{d:"M7 2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5"}],["path",{d:"M10 10 2.5 2.5C2 2 2 2.5 2 5v3a2 2 0 0 0 2 2h6z"}],["path",{d:"M22 17v-1a2 2 0 0 0-2-2h-1"}],["path",{d:"M4 14a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16.5l1-.5.5.5-8-8H4z"}],["path",{d:"M6 18h.01"}],["path",{d:"m2 2 20 20"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ct=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{cx:"12",cy:"12",r:"3"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zt=[["path",{d:"M12 2v13"}],["path",{d:"m16 6-4-4-4 4"}],["path",{d:"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ht=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{d:"m9 12 2 2 4-4"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tt=[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2"}],["path",{d:"M12 18h.01"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bt=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}],["path",{d:"M20 2v4"}],["path",{d:"M22 4h-4"}],["circle",{cx:"4",cy:"20",r:"2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jt=[["path",{d:"M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"}],["path",{d:"M15 3v5a1 1 0 0 0 1 1h5"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const It=[["circle",{cx:"12",cy:"12",r:"4"}],["path",{d:"M12 2v2"}],["path",{d:"M12 20v2"}],["path",{d:"m4.93 4.93 1.41 1.41"}],["path",{d:"m17.66 17.66 1.41 1.41"}],["path",{d:"M2 12h2"}],["path",{d:"M20 12h2"}],["path",{d:"m6.34 17.66-1.41 1.41"}],["path",{d:"m19.07 4.93-1.41 1.41"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ot=[["path",{d:"M12 2v8"}],["path",{d:"m4.93 10.93 1.41 1.41"}],["path",{d:"M2 18h2"}],["path",{d:"M20 18h2"}],["path",{d:"m19.07 10.93-1.41 1.41"}],["path",{d:"M22 22H2"}],["path",{d:"m8 6 4-4 4 4"}],["path",{d:"M16 18a4 4 0 0 0-8 0"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dt=[["path",{d:"M12 19h8"}],["path",{d:"m4 17 6-6-6-6"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ft=[["line",{x1:"10",x2:"14",y1:"2",y2:"2"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11"}],["circle",{cx:"12",cy:"14",r:"8"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rt=[["path",{d:"M8 3.1V7a4 4 0 0 0 8 0V3.1"}],["path",{d:"m9 15-1-1"}],["path",{d:"m15 15 1-1"}],["path",{d:"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"}],["path",{d:"m8 19-2 3"}],["path",{d:"m16 19 2 3"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vt=[["path",{d:"M10 11v6"}],["path",{d:"M14 11v6"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{d:"M3 6h18"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pt=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{cx:"9",cy:"7",r:"4"}],["line",{x1:"17",x2:"22",y1:"8",y2:"13"}],["line",{x1:"22",x2:"17",y1:"8",y2:"13"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nt=[["path",{d:"M12 20h.01"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764"}],["path",{d:"m2 2 20 20"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yt=[["path",{d:"M18 6 6 18"}],["path",{d:"m6 6 12 12"}]];/**
 * @license lucide v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ut=[["path",{d:"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"}]],Xt={"arrow-right":He,"arrow-up-right":Te,ban:Be,bell:je,"book-check":Ie,bus:De,calendar:Fe,check:Re,"chevron-down":Ve,"circle-check":Pe,clock:Ye,"cloud-off":Ue,copy:Ze,download:Qe,dumbbell:Je,"eye-off":et,code:tt,globe:ct,school:lt,"hard-drive":rt,house:pt,key:ht,languages:ut,tasks:gt,lock:vt,mail:$t,pin:bt,monitor:Mt,moon:kt,scale:Et,building:qt,"server-off":Lt,shield:Ht,smartphone:Tt,sparkles:Bt,sun:It,sunrise:Ot,laptop:ft,database:Ge,flag:nt,info:dt,refresh:St,heart:it,pencil:At,"code-xml":We,terminal:Dt,timer:Ft,train:Rt,"user-x":Pt,"wifi-off":Nt,x:Yt,"file-text":st,chat:_t,note:jt,clipboard:Ne,notebook:xt,activity:ze,bookmark:Oe,"cloud-rain":Xe,"cloud-sun":Ke,projects:ot,idea:yt,"message-circle":wt,settings:Ct,share:zt,trash:Vt,zap:Ut,more:at,dashboard:mt},Kt={apple:"M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",android:"M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z",windows:"M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623",github:"M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"},ka=a=>String(a).replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function Wt(a){return Object.entries(a).map(([e,t])=>`${e}="${ka(t)}"`).join(" ")}function u(a,{size:e=20,cls:t="",stroke:s=2,label:o}={}){const l=Xt[a],r=o?`role="img" aria-label="${ka(o)}"`:'aria-hidden="true" focusable="false"';if(!l)return X(a,{size:e,cls:t,label:o});const i=l.map(([p,d])=>`<${p} ${Wt(d)}/>`).join("");return`<svg class="icon ${t}" width="${e}" height="${e}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round" ${r}>${i}</svg>`}function X(a,{size:e=20,cls:t="",label:s}={}){const o=Kt[a];if(!o)return"";const l=s?`role="img" aria-label="${ka(s)}"`:'aria-hidden="true" focusable="false"';return`<svg class="icon icon-brand ${t}" width="${e}" height="${e}" viewBox="0 0 24 24" fill="currentColor" ${l}><path d="${o}"/></svg>`}const Zt="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z";function Gt({size:a=20,cls:e=""}={}){return`<svg class="icon icon-brand ${e}" width="${a}" height="${a}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${Zt}"/></svg>`}const I='<svg class="ap-chev" viewBox="0 0 8 14" aria-hidden="true" focusable="false"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg>';function ra({eyebrow:a,title:e,lede:t,top:s="",extra:o=""}){return`<header class="ap-page-hero">
    ${s}
    <p class="ap-eyebrow ap-reveal">${n(a)}</p>
    <h1 class="ap-page-title ap-reveal">${n(e)}</h1>
    ${t?`<p class="ap-page-lede ap-reveal">${n(t)}</p>`:""}
    ${o}
  </header>`}function Qt(a,[e,t,s,o],l,{max:r=s*1.2}={}){return`<figure class="ap-zoom ap-reveal" style="--rx: ${e}; --ry: ${t}; --rw: ${s}; --rh: ${o}; --ar: ${s} / ${o}; --max: ${Math.round(r)}px">
    <div class="ap-zoom-frame"><img src="/screens/${a}.webp" width="2880" height="1800" alt="${n(l)}" loading="lazy" decoding="async"></div>
  </figure>`}function K(a,e=20){const t=z[a];return t?t.mark==="linux"?Gt({size:e}):t.mark==="globe"?u("globe",{size:e}):X(t.mark,{size:e}):""}let J=null,ce=0;function W(){if(!J)return;const a=J;J=null,clearTimeout(ce),a.classList.remove("is-open"),setTimeout(()=>a.remove(),A()?0:320)}function Jt(a){W();const e=z[a],t=$(`steps.${a}`),s=document.createElement("div");s.className="dl-toast",s.setAttribute("role","status"),s.innerHTML=`<div class="dl-toast-luna">${q("geschafft",104)}</div>
    <div class="dl-toast-body">
      <p class="dl-toast-title">${n(c("home_download.done_title"))}</p>
      <p class="dl-toast-file mono">${n(e.file)}, ${B(e.bytes)} MB</p>
      ${Array.isArray(t)?`<ol>${t.map(o=>`<li>${n(o)}</li>`).join("")}</ol>`:""}
    </div>
    <button type="button" class="dl-toast-close" aria-label="${n(c("home_download.done_close"))}">${u("x",{size:18})}</button>`,document.body.append(s),J=s,requestAnimationFrame(()=>requestAnimationFrame(()=>s.classList.add("is-open"))),s.querySelector(".dl-toast-close").addEventListener("click",W),ce=setTimeout(()=>{const o=s.querySelector(".dl-toast-luna");o&&s.isConnected&&(o.innerHTML=q("ruhe",104,c("home_download.luna_label")))},4200)}let aa=null,wa=0;const le=a=>n(a).replace("{share}",u("share",{size:17,cls:"ap-share-glyph"})),Oa=a=>`<ol class="ap-sheet-steps">${a.map((e,t)=>`<li style="--i: ${t}">${le(e)}</li>`).join("")}</ol>`,re=["android","linux"],Da=a=>a==="choice"?re.map(e=>K(e,26)).join(""):K(a,30);function as(){const a=e=>`<button type="button" class="ap-sheet-pick" data-sheet-pick="${e}">
      <span class="ap-sheet-pick-mark">${K(e,24)}</span>
      <span class="ap-sheet-pick-name">${n(c(`platforms.${e}.name`))}</span>
      <span class="ap-sheet-pick-meta">${B(z[e].bytes)}&nbsp;MB</span>
    </button>`;return`<h2 class="ap-sheet-title" id="ap-sheet-title" tabindex="-1" autofocus aria-live="polite">${n(c("install.choice_title"))}</h2>
    <p class="ap-sheet-lead">${n(c("install.choice_lead"))}</p>
    <div class="ap-sheet-picks">${re.map(a).join("")}</div>`}function Fa(a){if(a==="choice")return as();const e=z[a];if(e.kind==="pwa")return`<h2 class="ap-sheet-title" id="ap-sheet-title" tabindex="-1" autofocus aria-live="polite">${n(c("install.web_title",{device:Ma(a)}))}</h2>
      <p class="ap-sheet-lead">${n(c("install.web_lead"))}</p>
      ${Oa($(`steps.${a}`)||[])}
      <div class="ap-sheet-actions"><a class="ap-btn ap-sheet-primary" href="${e.href}">${n(c("start.cta_web"))}</a></div>`;const t=e.alt?`<p class="ap-sheet-alt">${n(c(`platforms.${a}.alt`))} <a href="${e.alt.href}" download>${n(e.alt.file)}, ${B(e.alt.bytes)}&nbsp;MB</a></p>`:"";return`<h2 class="ap-sheet-title" id="ap-sheet-title" tabindex="-1" autofocus aria-live="polite">${n(c("install.title",{platform:c(`platforms.${a}.name`)}))}</h2>
    <p class="ap-sheet-meta"><span class="mono">${n(e.file)}</span>, ${B(e.bytes)}&nbsp;MB</p>
    <p class="ap-sheet-req">${n(c(`platforms.${a}.note`))}</p>
    <p class="ap-sheet-label">${n(c("install.after"))}</p>
    ${Oa($(`steps.${a}`)||[])}
    <div class="ap-sheet-actions">
      <a class="ap-btn ap-sheet-primary" href="${e.href}" download data-sheet-get>${n(c("install.get"))}</a>
      <a class="ap-link" href="/download#${a}" data-sheet-close>${n(c("start.get_all"))}${I}</a>
    </div>
    ${t}`}function R({instant:a=!1}={}){if(!aa)return;const e=aa;aa=null,clearTimeout(wa),document.body.classList.remove("sheet-open");const t=()=>{e.open&&e.close(),e.remove()};e.classList.remove("is-open"),e.classList.add("is-closing"),a||A()?t():setTimeout(t,240)}function es(a){a.querySelector(".ap-sheet-title").textContent=c("home_download.done_title"),a.querySelector("[data-sheet-mark]").innerHTML=q("geschafft",64);const e=a.querySelector(".ap-sheet-primary"),t=document.createElement("button");t.type="button",t.className="ap-btn ap-sheet-primary",t.dataset.sheetClose="",t.textContent=c("install.done"),e.replaceWith(t),t.focus({preventScroll:!0}),clearTimeout(wa),wa=setTimeout(()=>{const s=a.querySelector("[data-sheet-mark]");s&&a.isConnected&&(s.innerHTML=q("ruhe",64,c("home_download.luna_label")))},4200)}function ts(a){W(),R({instant:!0});const e=document.createElement("dialog");e.className="ap-sheet",e.setAttribute("aria-labelledby","ap-sheet-title"),e.innerHTML=`<div class="ap-sheet-card">
      <div class="ap-sheet-top">
        <span class="ap-sheet-mark${a==="choice"?" is-pair":""}" data-sheet-mark>${Da(a)}</span>
        <button type="button" class="ap-sheet-close" data-sheet-close aria-label="${n(c("home_download.done_close"))}">${u("x",{size:18})}</button>
      </div>
      <div class="ap-sheet-body" data-sheet-body>${Fa(a)}</div>
    </div>`,e.addEventListener("click",t=>{if(t.target.closest("a[data-sheet-close]"))return R({instant:!0});if(t.target===e||t.target.closest("[data-sheet-close]"))return R();t.target.closest("[data-sheet-get]")&&setTimeout(()=>e.isConnected&&es(e),0);const s=t.target.closest("[data-sheet-pick]");if(s){const o=e.querySelector("[data-sheet-mark]");o.classList.remove("is-pair"),o.innerHTML=Da(s.dataset.sheetPick),e.querySelector("[data-sheet-body]").innerHTML=Fa(s.dataset.sheetPick),e.querySelector(".ap-sheet-title").focus({preventScroll:!0})}}),e.addEventListener("cancel",t=>{t.preventDefault(),R()}),document.body.append(e),aa=e,e.showModal(),document.body.classList.add("sheet-open"),requestAnimationFrame(()=>requestAnimationFrame(()=>e.classList.add("is-open")))}const ss=a=>a.button===0&&!a.metaKey&&!a.ctrlKey&&!a.shiftKey&&!a.altKey,ns=typeof HTMLDialogElement=="function"&&"showModal"in HTMLDialogElement.prototype;function ie(a){const e=s=>{var i;const o=s.target.closest("[data-copy]");if(o){(i=navigator.clipboard)==null||i.writeText(o.dataset.copy).then(()=>{const p=o.querySelector("span");p.textContent=c("steps.copied"),o.classList.add("is-done"),setTimeout(()=>{p.textContent=c("steps.copy"),o.classList.remove("is-done")},1800)}).catch(()=>{});return}const l=s.target.closest("[data-install]");if(l&&ns&&ss(s)&&(z[l.dataset.install]||l.dataset.install==="choice")){s.preventDefault(),ts(l.dataset.install);return}const r=s.target.closest("[data-download]");r&&Jt(r.dataset.download)},t=s=>{s.key==="Escape"&&W()};return a.addEventListener("click",e),document.addEventListener("keydown",t),()=>{a.removeEventListener("click",e),document.removeEventListener("keydown",t),W(),R({instant:!0})}}const P={macos:"Mac",windows:"Windows",linux:"Linux",android:"Android",ios:"iPhone",web:"Browser"};function os(a){return a.length<2?a.join(""):`${a.slice(0,-1).join(", ")} ${G()==="de"?"und":"and"} ${a.at(-1)}`}const da=(...a)=>os(ae.filter(e=>!a.includes(e)&&e!=="web").map(e=>P[e]));function xa(){const a=ca(),e=z[a];if(!e){const s=se();if(s.length>1){const o=c("start.cta_note_choice",{first:P[s[0]],second:P[s[1]],others:da(...s)});return{id:a,choices:s,button:`<a class="ap-btn" href="/download" data-install="choice">${n(c("start.cta"))}</a>`,note:o}}return{id:a,choices:s,button:`<a class="ap-btn" href="/download">${n(c("start.cta_generic"))}</a>`,note:c("start.cta_note_generic")}}if(e.kind==="pwa"){const s=a==="ios"?' data-install="ios"':"",o=c("start.cta_note_web",{device:Ma(a),others:da(a)});return{id:a,button:`<a class="ap-btn" href="${e.href}"${s}>${n(c("start.cta_web"))}</a>`,note:o}}const t=c("start.cta_note",{platform:P[a],size:B(e.bytes),others:da(a)});return{id:a,button:`<a class="ap-btn" href="${e.href}" download data-install="${a}">${n(c("start.cta"))}</a>`,note:t}}const Ra='<svg viewBox="0 0 12 20" aria-hidden="true" focusable="false"><path d="M8.5 3.5 2 10l6.5 6.5"/></svg>';function cs({id:a,label:e,cards:t}){const s=t.map((l,r)=>`<li class="hl-card hl-${l.id}" data-card="${r}">
      <p class="hl-caption"><strong>${n(l.lead)}</strong> ${n(l.text)}</p>
      <div class="hl-visual">${l.visual}</div>
    </li>`).join(""),o=t.map((l,r)=>`<button type="button" class="hl-dot" data-go="${r}" aria-label="${n(c("start.high_dot",{n:r+1,total:t.length}))}"${r===0?' aria-current="true"':""}><span></span></button>`).join("");return`<div class="hl" data-gallery="${a}">
    <ul class="hl-track" data-track tabindex="0" aria-label="${n(e)}">${s}</ul>
    <div class="hl-controls">
      <div class="hl-dots" style="--i: 0"><span class="hl-pill" aria-hidden="true"></span>${o}</div>
      <div class="hl-arrows">
        <button type="button" class="hl-arrow" data-step="-1" aria-label="${n(c("start.high_prev"))}" disabled>${Ra}</button>
        <button type="button" class="hl-arrow hl-arrow-next" data-step="1" aria-label="${n(c("start.high_next"))}">${Ra}</button>
      </div>
    </div>
  </div>`}function ls(a){const e=a.querySelector("[data-gallery]");if(!e)return()=>{};const t=e.querySelector("[data-track]"),s=[...t.querySelectorAll(".hl-card")],o=[...e.querySelectorAll(".hl-dot")],l=e.querySelector(".hl-dots"),[r,i]=e.querySelectorAll(".hl-arrow");let p=0,d=0;const f=g=>g.offsetLeft-s[0].offsetLeft,M=g=>{const _=Math.max(0,Math.min(s.length-1,g));t.scrollTo({left:f(s[_]),behavior:A()?"auto":"smooth"})},S=()=>{d=0;const g=t.scrollWidth-t.clientWidth;let _=0,k=1/0;s.forEach((b,H)=>{const qa=Math.abs(f(b)-t.scrollLeft);qa<k&&(k=qa,_=H)}),t.scrollLeft>=g-4&&(_=s.length-1),_!==p&&(p=_,o.forEach((b,H)=>H===p?b.setAttribute("aria-current","true"):b.removeAttribute("aria-current")),l.style.setProperty("--i",p)),r.disabled=t.scrollLeft<=4,i.disabled=t.scrollLeft>=g-4},y=()=>{d||(d=requestAnimationFrame(S))},m=g=>{const _=g.target.closest("[data-go]");if(_)return M(Number(_.dataset.go));const k=g.target.closest("[data-step]");k&&M(p+Number(k.dataset.step))};return t.addEventListener("scroll",y,{passive:!0}),e.addEventListener("click",m),S(),()=>{cancelAnimationFrame(d),t.removeEventListener("scroll",y),e.removeEventListener("click",m)}}const ea="cubic-bezier(0.16, 1, 0.3, 1)",x="cubic-bezier(0.34, 1.45, 0.64, 1)",N=[{id:"home",old:0,now:0,glyph:"house"},{id:"tasks",old:1,now:1,glyph:"tasks"},{id:"pomodoro",old:2,glyph:"timer"},{id:"calendar",old:3,now:2,glyph:"calendar"},{id:"transit",old:4,now:4,glyph:"train"},{id:"school",old:5,now:3,glyph:"school"},{id:"training",old:6,glyph:"dumbbell"},{id:"projects",old:7,glyph:"projects"},{id:"knowledge",old:8,glyph:"idea"},{id:"bookmarks",old:9,glyph:"bookmark"},{id:"mail",old:10,now:5,glyph:"mail"},{id:"review",old:11,glyph:"activity"},{id:"mousepad",old:12,glyph:"notebook"},{id:"assistant",old:13,glyph:"message-circle"},{id:"settings",old:14,glyph:"settings"}],rs=[{hour:13,rain:0,glyph:"sun"},{hour:14,rain:0,glyph:"sun"},{hour:15,rain:10,glyph:"cloud-sun"},{hour:16,rain:30,glyph:"cloud-sun"},{hour:17,rain:60,glyph:"cloud-rain"},{hour:18,rain:70,glyph:"cloud-rain"}],is=["login","mail","iserv","assistant","desktop","web"],Va=[["#E3EFEB","#2A8E8E"],["#F6E8E8","#B26D7E"],["#E5EDF3","#5986BD"]],ps=[["tasks","tasks"],["calendar","events"],["school","grades"],["key","logins"]],h=a=>n(c(`start.scene.${a}`)),ds=()=>G()==="de"?"de-DE":"en-IE";function Aa(a="sc-mark"){return`<svg class="${a}" viewBox="14 18 72 66" aria-hidden="true" focusable="false"><circle cx="40" cy="44" r="26" fill="#E7C694"/><rect x="44" y="42" width="42" height="42" rx="12" fill="#A3B690"/><path d="M44 69.69V54A12 12 0 0 1 56 42H65.92A26 26 0 0 1 44 69.69Z" fill="#2E3A2F"/></svg>`}function hs(){const a=$("start.scene.nav")||{},e=N.filter(o=>o.now!==void 0).sort((o,l)=>o.now-l.now),t=N.filter(o=>o.now===void 0),s=o=>{const l=o.id==="home"?c("start.scene.nav_home"):a[o.id],r=o.id==="home"?` data-old-label="${n(c("start.scene.nav_home_old"))}"`:"";return`<li class="sc-nav-row${o.id==="home"?" is-current":""}" data-old="${o.old}"${o.now===void 0?" hidden":""}>${u(o.glyph,{size:17})}<span${r}>${n(l||"")}</span></li>`};return`<div class="sc sc-nav" data-scene="nav" role="img" aria-label="${h("nav_alt")}">
    <div class="sc-app sc-side">
      <p class="sc-side-brand">${Aa()}<span>${n(E)}</span></p>
      <ul class="sc-nav-list">${e.map(s).join("")}${t.map(s).join("")}<li class="sc-nav-row sc-nav-more" data-more>${u("more",{size:17})}<span>${h("nav_more")}</span>${u("chevron-down",{size:15,cls:"sc-nav-chev"})}</li></ul>
    </div>
  </div>`}function us(){const a=rs.map(e=>`<li class="sc-hour${e.rain>=50?" is-wet":""}">
      <span class="sc-hour-rain">${e.rain?`${e.rain} %`:""}</span>
      <span class="sc-hour-bar"><i style="--v:${Math.max(e.rain,6)/100}"></i></span>
      ${u(e.glyph,{size:17,cls:"sc-hour-glyph"})}
      <span class="sc-hour-time">${e.hour}</span>
    </li>`).join("");return`<div class="sc sc-weather" data-scene="weather" role="img" aria-label="${h("weather_alt")}">
    <div class="sc-app sc-today">
      <p class="sc-today-meta">${u("sunrise",{size:15})}${h("weather_meta")}</p>
      <p class="sc-today-line">${h("weather_way")} <span class="sc-line-badge">${h("weather_line")}</span> ${h("weather_time")} <span class="sc-weather-chip" data-pop>${h("weather_dry")}</span></p>
      <ol class="sc-hours">${a}</ol>
      <p class="sc-today-event" data-pop>${u("dumbbell",{size:16})}<span>${h("weather_event")}</span><span class="sc-rain-chip">${h("weather_rain")}</span></p>
    </div>
  </div>`}function fs(){const a=Array.from({length:12},(e,t)=>`<i${t===0?' class="is-on"':""}></i>`).join("");return`<div class="sc sc-tour" data-scene="tour" role="img" aria-label="${h("tour_alt")}">
    <div class="sc-tour-mascot">${q("ruhe",170,"",{still:!0})}</div>
    <div class="sc-app sc-bubble">
      <p class="sc-bubble-steps"><span class="sc-dots">${a}</span><span>${h("tour_step")}</span></p>
      <p class="sc-bubble-text">${h("tour_text")}</p>
      <p class="sc-bubble-actions"><span class="sc-btn is-primary">${h("tour_go")}</span><span class="sc-btn">${h("tour_later")}</span></p>
    </div>
  </div>`}function ms(){const a=$("start.scene.security")||{},e=is.map(t=>`<li class="sc-check-row"><span class="sc-check">${u("check",{size:14,stroke:3})}</span>${n(a[t]||"")}</li>`).join("");return`<div class="sc sc-shield" data-scene="shield" role="img" aria-label="${h("security_alt")}">
    <div class="sc-app sc-app-night sc-report">
      <div class="sc-report-head">
        <span class="sc-report-glyph">${u("shield",{size:22})}</span>
        <p class="sc-report-title">${h("security_title")}<span>${h("security_version")}</span></p>
        <p class="sc-report-count"><b><i data-tally>30</i>+</b><small>${h("security_fixes")}</small></p>
      </div>
      <ul class="sc-check-list">${e}</ul>
    </div>
  </div>`}function ys(){const a=$("start.scene.sync_lessons")||[],e=a.length-1,t=i=>{const[p,d]=Va[i%Va.length];return`style="--fill:${p};--stripe:${d}"`},s=(i,p,d)=>p===e?`<span class="sc-sync-room is-changed" data-room="${d}"><i class="sc-sync-mark"></i><b>${n(i.room)}</b>${d==="laptop"?'<i class="sc-sync-caret"></i>':""}</span>`:`<span class="sc-sync-room"><b>${n(i.room)}</b></span>`,o=i=>`<span class="sc-sync-subject">${n(i.subject)}</span>`,l=a.map((i,p)=>`<li class="sc-sync-row"><span class="sc-sync-time">${n(i.time)}</span><span class="sc-sync-lesson" ${t(p)}>${o(i)}${s(i,p,"laptop")}</span></li>`).join(""),r=a.map((i,p)=>`<li class="sc-sync-lesson"${p===e?" data-tile":""} ${t(p)}>${o(i)}${s(i,p,"phone")}</li>`).join("");return`<div class="sc sc-sync" data-scene="sync" data-old-room="${h("sync_room_old")}" role="img" aria-label="${h("sync_alt")}">
    <div class="sc-sync-laptop">
      <div class="sc-app sc-sync-screen">
        <p class="sc-sync-head">${Aa()}<b>${h("sync_title")}</b><span>${h("sync_day")}</span></p>
        <ol class="sc-sync-list">${l}</ol>
      </div>
      <span class="sc-sync-base"></span>
    </div>
    <div class="sc-app sc-sync-phone">
      <span class="sc-sync-island"></span>
      <p class="sc-sync-day">${h("sync_day")}</p>
      <ol class="sc-sync-tiles">${r}</ol>
    </div>
    <span class="sc-sync-packet"><span>${u("lock",{size:15,stroke:2.4})}<i></i><i></i><i></i><i></i></span></span>
    <p class="sc-sync-done">${u("lock",{size:16,stroke:2.2})}${h("sync_done")}</p>
  </div>`}function gs(){return`<div class="sc sc-guard" data-scene="guard" role="img" aria-label="${h("guard_alt")}">
    <div class="sc-guard-mascot">${q("geschafft",118,"",{still:!0})}</div>
    <div class="sc-app sc-actions">
      <div class="sc-action is-done"><span class="sc-action-glyph">${u("tasks",{size:18})}</span><p>${h("guard_done")}<span>${h("guard_task")}</span></p><span class="sc-check is-big">${u("check",{size:16,stroke:3})}</span></div>
      <div class="sc-action is-asked"><span class="sc-action-glyph">${u("circle-check",{size:18})}</span><p>${h("guard_check")}<span>${h("guard_yours")}</span></p><span class="sc-ask">${u("message-circle",{size:17})}</span></div>
      <div class="sc-action is-denied"><span class="sc-action-glyph">${u("trash",{size:18})}</span><p>${h("guard_delete")}<span>${h("guard_never")}</span></p><span class="sc-deny">${u("ban",{size:18})}</span></div>
    </div>
  </div>`}function vs(){const a=ps.map(([e,t])=>`<li>${u(e,{size:15})}${h(`move_${t}`)}</li>`).join("");return`<div class="sc sc-move" data-scene="move" role="img" aria-label="${h("move_alt")}">
    <div class="sc-move-from"><span class="sc-move-old">N</span><span class="sc-move-caption">${h("move_from")}</span></div>
    <svg class="sc-move-path" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M4 56 C 60 -8, 140 -8, 196 56"/></svg>
    <div class="sc-move-to"><span class="sc-move-icon">${Aa("sc-move-mark")}</span><span class="sc-move-caption">${n(E)} 0.6</span></div>
    <ul class="sc-move-chips">${a}</ul>
    <p class="sc-move-done">${u("circle-check",{size:17})}${h("move_done")}</p>
  </div>`}function $s(){return`<div class="sc sc-phones" data-scene="phones" role="img" aria-label="${n(c("start.card_alt_phones"))}">${V("/screens/phone-aufgaben.webp","")}${V("/screens/phone-heute.webp","")}${V("/screens/phone-abend.webp","",{dark:!0})}</div>`}function bs(){const a=$("start.scene.days")||[],e=[],s=(new Date(2026,9,1).getDay()+6)%7;for(let o=0;o<35;o++){const l=new Date(2026,9,1-s+o),r=l.getMonth()===9,i=r&&l.getDate()===3;e.push(`<span class="sc-date${r?"":" is-out"}${i?" is-holiday":""}">${l.getDate()}</span>`)}return`<div class="sc sc-cal" data-scene="cal" role="img" aria-label="${h("cal_alt")}">
    <div class="sc-app sc-month">
      <p class="sc-month-head"><b>${h("cal_month")}</b>${h("cal_year")}<span class="sc-month-chip">${u("pin",{size:14})}${h("cal_states")}</span></p>
      <div class="sc-month-dows">${a.map(o=>`<span>${n(o)}</span>`).join("")}</div>
      <div class="sc-month-weeks">
        <div class="sc-month-bands"><span class="sc-band" style="grid-area: 4 / 1 / 5 / 8"></span><span class="sc-band" style="grid-area: 5 / 1 / 6 / 6"></span></div>
        <div class="sc-month-days">${e.join("")}</div>
      </div>
      <p class="sc-month-legend"><i></i>${h("cal_break")}<i class="is-holiday"></i>${h("cal_holiday")}</p>
    </div>
  </div>`}const ha={theme:hs,weather:us,tour:fs,security:ms,sync:ys,luna:gs,move:vs,phone:$s,holidays:bs};function w(a,e){Object.assign(a.style,e)}function v(a,e,t){for(const s of Object.keys(e))a.style[s]="";return a.animate([e,{}],{fill:"backwards",easing:ea,duration:620,...t})}function ws(a,e,t,s,o=0){const l=new Intl.NumberFormat(ds(),{minimumFractionDigits:o,maximumFractionDigits:o}),r=performance.now(),i=p=>{const d=Math.min(1,(p-r)/s);a.textContent=l.format(e+(t-e)*(1-Math.pow(1-d,3))),d<1&&requestAnimationFrame(i)};a.textContent=l.format(e),requestAnimationFrame(i)}const L={opacity:"0",transform:"translateY(18px) scale(0.97)"},T={opacity:"0",transform:"scale(0.6)"},ua={opacity:"0",transform:"scale(1.5) rotate(-10deg)"},_s={nav:{prepare(a){const e=a.querySelector(".sc-nav-list");[...e.querySelectorAll("[data-old]")].sort((o,l)=>o.dataset.old-l.dataset.old).forEach(o=>{o.hidden=!1,e.insertBefore(o,e.querySelector("[data-more]"))});const s=e.querySelector("[data-old-label]");s.dataset.newLabel=s.textContent,s.textContent=s.dataset.oldLabel,e.querySelector("[data-more]").hidden=!0},play(a,e){const t=a.querySelector(".sc-nav-list"),s=[...t.querySelectorAll("[data-old]")],o=s.filter(l=>!N[l.dataset.old].hasOwnProperty("now"));o.forEach((l,r)=>l.animate([{},{opacity:0,transform:"translateX(-14px) scale(0.96)"}],{duration:260,delay:120+r*45,easing:"cubic-bezier(0.5, 0, 0.75, 0)",fill:"forwards"})),e(120+o.length*45+240,()=>{const l=s.filter(d=>!o.includes(d)),r=new Map(l.map(d=>[d,d.getBoundingClientRect().top]));o.forEach(d=>{d.getAnimations().forEach(f=>f.cancel()),d.hidden=!0}),l.sort((d,f)=>N[d.dataset.old].now-N[f.dataset.old].now).forEach(d=>t.insertBefore(d,t.querySelector("[data-more]")));const i=t.querySelector("[data-old-label]");i.textContent=i.dataset.newLabel;const p=t.querySelector("[data-more]");p.hidden=!1,l.forEach((d,f)=>{const M=r.get(d)-d.getBoundingClientRect().top;M&&d.animate([{transform:`translateY(${M}px)`},{}],{duration:620,delay:f*30,easing:x})}),i.animate([{opacity:.2,transform:"translateY(6px)"},{}],{duration:420,easing:ea}),v(p,L,{delay:260,duration:520})})}},weather:{prepare(a){a.querySelectorAll(".sc-hour-bar i").forEach(e=>w(e,{transform:"scaleY(0)"})),a.querySelectorAll(".sc-hour-rain").forEach(e=>w(e,{opacity:"0"})),a.querySelectorAll("[data-pop]").forEach(e=>w(e,T))},play(a){a.querySelectorAll(".sc-hour-bar i").forEach((s,o)=>v(s,{transform:"scaleY(0)"},{delay:150+o*90,duration:760})),a.querySelectorAll(".sc-hour-rain").forEach((s,o)=>v(s,{opacity:"0"},{delay:520+o*90,duration:300}));const[e,t]=a.querySelectorAll("[data-pop]");v(e,T,{delay:820,duration:560,easing:x}),v(t,L,{delay:1080,duration:560})}},tour:{prepare(a){w(a.querySelector(".sc-tour-mascot"),{opacity:"0",transform:"translateY(40px) scale(0.86)"}),w(a.querySelector(".sc-bubble"),T),a.querySelectorAll(".sc-dots i").forEach(e=>w(e,{opacity:"0",transform:"scale(0)"}))},play(a){v(a.querySelector(".sc-tour-mascot"),{opacity:"0",transform:"translateY(40px) scale(0.86)"},{duration:760,easing:x}),v(a.querySelector(".sc-bubble"),T,{delay:260,duration:620,easing:x}),a.querySelectorAll(".sc-dots i").forEach((e,t)=>v(e,{opacity:"0",transform:"scale(0)"},{delay:620+t*40,duration:380,easing:x}))}},shield:{prepare(a){a.querySelectorAll(".sc-check-row").forEach(e=>w(e,{opacity:"0",transform:"translateY(12px)"})),a.querySelectorAll(".sc-check").forEach(e=>w(e,{opacity:"0",transform:"scale(1.4) rotate(-8deg)"})),a.querySelector("[data-tally]").textContent="0"},play(a){const e=a.querySelectorAll(".sc-check-row");e.forEach((t,s)=>{v(t,{opacity:"0",transform:"translateY(12px)"},{delay:120+s*110,duration:520}),v(t.querySelector(".sc-check"),{opacity:"0",transform:"scale(1.4) rotate(-8deg)"},{delay:300+s*110,duration:460,easing:x})}),ws(a.querySelector("[data-tally]"),0,30,120+e.length*110+400)}},sync:{prepare(a){a.querySelectorAll("[data-room] b").forEach(e=>{e.dataset.room=e.textContent,e.textContent=a.dataset.oldRoom}),a.querySelectorAll(".sc-sync-mark").forEach(e=>w(e,T)),a.querySelector('[data-room="phone"]').classList.add("is-waiting"),w(a.querySelector(".sc-sync-done"),L)},play(a,e){const t=a.querySelector('[data-room="laptop"]'),s=a.querySelector('[data-room="phone"]'),o=t.querySelector("b"),l=a.dataset.oldRoom,r=o.dataset.room;v(t.querySelector(".sc-sync-mark"),T,{delay:120,duration:420,easing:x}),t.querySelector(".sc-sync-caret").animate([{opacity:1},{opacity:1,offset:.9},{opacity:0}],{delay:120,duration:700}),[...l].forEach((k,b)=>e(220+b*45,()=>o.textContent=l.slice(0,l.length-b-1))),[...r].forEach((k,b)=>e(420+b*80,()=>o.textContent=r.slice(0,b+1)));const i=a.getBoundingClientRect(),p=k=>{const b=k.getBoundingClientRect();return[b.left+b.width/2-i.left,b.top+b.height/2-i.top]},[d,f]=p(t),[M,S]=p(s),y=a.querySelector(".sc-sync-packet");Object.assign(y.style,{left:`${d}px`,top:`${f}px`});const m=`translate(${M-d}px, ${S-f}px)`,g=Math.max(56,(M-d)*.45),_={delay:780,duration:1250};y.animate([{opacity:0,transform:"none",easing:ea},{opacity:1,transform:"none",offset:.18},{opacity:1,transform:"none",offset:.26,easing:"cubic-bezier(0.45, 0, 0.35, 1)"},{opacity:1,transform:m,offset:.86,easing:"cubic-bezier(0.5, 0, 0.75, 0)"},{opacity:0,transform:m}],_),y.firstElementChild.animate([{transform:"translateY(0) scale(0.4)",easing:x},{transform:"translateY(-8px) scale(1)",offset:.18},{transform:"translateY(-8px) scale(1)",offset:.26,easing:"cubic-bezier(0.3, 0.55, 0.55, 1)"},{transform:`translateY(${-g}px) scale(1)`,offset:.56,easing:"cubic-bezier(0.45, 0, 0.7, 0.45)"},{transform:"translateY(0) scale(0.92)",offset:.86,easing:"cubic-bezier(0.5, 0, 0.75, 0)"},{transform:"translateY(0) scale(0.4)"}],_),e(1830,()=>{const k=s.querySelector("b");k.textContent=k.dataset.room,s.classList.remove("is-waiting"),k.animate([{opacity:0,transform:"translateY(60%)"},{}],{duration:460,easing:x}),v(s.querySelector(".sc-sync-mark"),T,{duration:520,easing:x}),a.querySelector("[data-tile]").animate([{},{transform:"scale(1.04)"},{}],{duration:440,easing:"ease-out"})}),v(a.querySelector(".sc-sync-done"),L,{delay:2080,duration:540})}},guard:{prepare(a){w(a.querySelector(".sc-guard-mascot"),{opacity:"0",transform:"translateY(30px) scale(0.9)"}),a.querySelectorAll(".sc-action").forEach(e=>w(e,L)),a.querySelectorAll(".sc-check.is-big, .sc-ask, .sc-deny").forEach(e=>w(e,ua))},play(a){var l;const[e,...t]=a.querySelectorAll(".sc-action"),s=t.filter(r=>r.classList.contains("is-denied"));v(a.querySelector(".sc-guard-mascot"),{opacity:"0",transform:"translateY(30px) scale(0.9)"},{duration:700,easing:x}),v(e,L,{delay:220}),v(a.querySelector(".sc-check.is-big"),ua,{delay:620,duration:480,easing:x}),(l=t.map((r,i)=>(v(r,L,{delay:900+i*160}),v(r.querySelector(".sc-ask, .sc-deny"),ua,{delay:1220+i*160,duration:460,easing:x}))).at(-1))==null||l.finished.then(()=>{s.forEach(r=>r.animate([{},{transform:"translateX(-7px)"},{transform:"translateX(6px)"},{transform:"translateX(-3px)"},{}],{duration:440,easing:"ease-in-out"}))},()=>{})}},move:{prepare(a){a.querySelectorAll(".sc-move-chips li").forEach(e=>w(e,{opacity:"0"})),w(a.querySelector(".sc-move-done"),L)},play(a,e){const t=a.querySelector(".sc-move-old").getBoundingClientRect(),s=[...a.querySelectorAll(".sc-move-chips li")];s.forEach((o,l)=>{o.style.opacity="";const r=o.getBoundingClientRect(),i=t.left+t.width/2-(r.left+r.width/2),p=t.top+t.height/2-(r.top+r.height/2);o.animate([{opacity:0,transform:`translate(${i}px, ${p}px) scale(0.4)`},{opacity:1,transform:`translate(${i*.55}px, ${p*.55-70}px) scale(0.9)`,offset:.5},{opacity:1,transform:"none"}],{delay:200+l*150,duration:900,easing:ea,fill:"backwards"})}),e(200+s.length*150+700,()=>{a.querySelector(".sc-move-icon").animate([{},{transform:"scale(1.12, 0.9)"},{transform:"scale(0.96, 1.05)"},{}],{duration:480,easing:"ease-out"}),v(a.querySelector(".sc-move-done"),L,{delay:180,duration:520})})}},phones:{prepare(a){a.querySelectorAll(".iphone").forEach(e=>w(e,{opacity:"0",translate:"0 90px"}))},play(a){a.querySelectorAll(".iphone").forEach((e,t)=>v(e,{opacity:"0",translate:"0 90px"},{delay:[140,0,280][t],duration:900,easing:x}))}},cal:{prepare(a){a.querySelectorAll(".sc-band").forEach(e=>w(e,{transform:"scaleX(0)"})),a.querySelectorAll(".sc-month-legend, .sc-date.is-holiday").forEach(e=>w(e,{opacity:"0"}))},play(a){a.querySelectorAll(".sc-band").forEach((e,t)=>v(e,{transform:"scaleX(0)"},{delay:250+t*420,duration:700})),v(a.querySelector(".sc-month-legend"),{opacity:"0"},{delay:900,duration:480}),a.querySelectorAll(".sc-date.is-holiday").forEach(e=>v(e,T,{delay:1300,duration:500,easing:x}))}}};function Ms(a){const e=[...a.querySelectorAll("[data-scene]")];if(!e.length||A()||!("IntersectionObserver"in window))return()=>{};const t=[],s=(r,i)=>t.push(setTimeout(i,r)),o=new Map;e.forEach(r=>{const i=_s[r.dataset.scene],p=r.closest(".hl-card");!i||!p||(i.prepare(r),o.set(p,()=>i.play(r,s)))});const l=new IntersectionObserver(r=>{r.forEach(i=>{var p;i.isIntersecting&&(l.unobserve(i.target),(p=o.get(i.target))==null||p())})},{threshold:.6});return o.forEach((r,i)=>l.observe(i)),()=>{l.disconnect(),t.forEach(clearTimeout)}}const ks=[["#E7C694",-58,-30],["#A3B690",60,-26],["#B7A6F6",-66,22],["#C1657E",64,26],["#4FBADE",-30,58],["#E88F86",34,60]];function pe(a,e=""){const t=ks.map(([s,o,l])=>`<circle class="lk-dot" cx="80" cy="95" r="4.2" fill="${s}" data-x="${o}" data-y="${l}"/>`).join("");return`<div class="lk ${e}" data-lock role="img" aria-label="${n(a)}">
    <svg viewBox="0 0 160 160" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id="lk-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBFBFD"/><stop offset="1" stop-color="#C4C4C9"/></linearGradient>
        <linearGradient id="lk-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8E8E93"/><stop offset="0.5" stop-color="#EDEDF0"/><stop offset="1" stop-color="#8E8E93"/></linearGradient>
      </defs>
      <circle class="lk-ring" cx="80" cy="97" r="44"/>
      <g class="lk-dots">${t}</g>
      <path class="lk-shackle" d="M61 78V60a19 19 0 0 1 38 0v18"/>
      <g class="lk-body-group">
        <rect class="lk-body" x="48" y="72" width="64" height="52" rx="13"/>
        <rect class="lk-shine" x="52" y="75" width="56" height="10" rx="5"/>
        <circle class="lk-hole" cx="80" cy="95" r="6.5"/>
        <rect class="lk-hole" x="77.2" y="97" width="5.6" height="12" rx="2.8"/>
      </g>
    </svg>
  </div>`}function xs(a){const e="cubic-bezier(0.28, 0.11, 0.32, 1)";[...a.querySelectorAll(".lk-dot")].forEach((s,o)=>{const l=`translate(${s.dataset.x}px, ${s.dataset.y}px) scale(1)`;s.animate([{transform:l,opacity:0},{transform:l,opacity:1,offset:.2},{transform:"translate(0, 0) scale(0.2)",opacity:0}],{duration:760,delay:80+o*45,easing:"cubic-bezier(0.55, 0, 0.75, 0.3)",fill:"both"})}),a.querySelector(".lk-shackle").animate([{transform:"translate(0, -17px) rotate(-26deg)"},{transform:"translate(0, -17px) rotate(0deg)",offset:.5,easing:"cubic-bezier(0.55, 0, 0.9, 0.55)"},{transform:"translate(0, 3px) rotate(0deg)",offset:.82,easing:e},{transform:"translate(0, 0) rotate(0deg)"}],{duration:720,delay:560,easing:e,fill:"both"}),a.querySelector(".lk-body-group").animate([{transform:"scale(1, 1)"},{transform:"scale(1.045, 0.95)",offset:.35},{transform:"scale(1, 1)"}],{duration:320,delay:1150,easing:e}),a.querySelector(".lk-ring").animate([{transform:"scale(1)",opacity:.55},{transform:"scale(1.75)",opacity:0}],{duration:900,delay:1160,easing:"cubic-bezier(0.2, 0.7, 0.3, 1)",fill:"forwards"});for(const s of a.querySelectorAll(".lk-hole"))s.animate([{fill:"#1D1D1F"},{fill:"#E7C694"}],{duration:420,delay:1180,easing:e,fill:"both"})}function de(a){const e=[...a.querySelectorAll("[data-lock]")];if(!e.length)return()=>{};if(A()||!("IntersectionObserver"in window)||!Element.prototype.animate)return e.forEach(s=>s.classList.add("is-closed")),()=>{};e.forEach(s=>s.classList.add("is-armed"));const t=new IntersectionObserver(s=>{for(const o of s)o.isIntersecting&&(t.unobserve(o.target),o.target.classList.replace("is-armed","is-closed"),xs(o.target))},{threshold:.7});return e.forEach(s=>t.observe(s)),()=>t.disconnect()}const As=a=>n(a).replace(/(\S+-\S+)/g,'<span class="nw">$1</span>'),Ss=a=>n(a).split(/\s+/).map(e=>`<span class="w">${e}</span>`).join(" ");function Es(){const{id:a,choices:e,button:t,note:s}=xa(),l=(e!=null&&e.length?e:[a]).every(r=>Me.has(r))?c("start.lede"):c("start.lede_plain");return`<section class="ap-hero" aria-labelledby="ap-hero-title">
    <div class="ap-hero-copy" data-hero-copy>
      <h1 class="ap-hero-head" id="ap-hero-title"><span class="ap-hero-name">${n(c("start.intro"))}</span><span class="ap-hero-title">${n(c("start.title"))}</span></h1>
      <p class="ap-hero-lede">${n(l)}</p>
      <div class="ap-hero-cta">${t}<a class="ap-link" href="#tag">${n(c("start.more"))}${I}</a></div>
      <p class="ap-hero-note">${n(s)}</p>
    </div>
    <div class="ap-hero-device" data-hero-device>${la([{id:"heute",alt:c("start.hero_alt")}],{eager:!0,phone:"phone-heute",phoneAlt:c("start.hero_alt_phone")})}</div>
  </section>`}function qs(){return`<section class="ap-statement" data-statement aria-label="${n(E)}">
    <div class="ap-statement-pin"><p class="ap-words" data-words>${Ss(c("start.statement"))}</p></div>
  </section>`}function Ls(){const a=$("start.steps")||[],e=a.map((t,s)=>`<li class="ap-step${s===0?" is-active":""}" data-step="${t.id}">
      <p class="ap-step-label">${n(t.label)}</p>
      <h3 class="ap-step-title">${As(t.title)}</h3>
      <p class="ap-step-text">${n(t.text)}</p>
      <div class="ap-step-phone">${V(`/screens/phone-${t.id}.webp`,t.alt_phone||t.alt,{only:"phone"})}</div>
    </li>`).join("");return`<section class="ap-show" id="tag" aria-labelledby="ap-show-title">
    <h2 class="ap-h2 ap-show-title ap-reveal" id="ap-show-title">${n(c("start.show_title"))}</h2>
    <div class="ap-show-body">
      <ol class="ap-steps">${e}</ol>
      <div class="ap-show-stage"><div class="ap-show-sticky" data-show-device>${la(a.map(t=>({id:t.id,alt:t.alt})))}</div></div>
    </div>
  </section>`}function Cs(){const a=($("start.cards")||[]).map(e=>{var t;return{...e,visual:((t=ha[e.id])==null?void 0:t.call(ha))||""}});return`<section class="ap-high" aria-labelledby="ap-high-title">
    <h2 class="ap-h2 ap-high-title ap-reveal" id="ap-high-title">${n(c("start.high_title"))}</h2>
    ${cs({id:"highlights",label:c("start.high_label"),cards:a})}
  </section>`}function zs(){const e=($("start.chat")||[]).map((t,s)=>`<li class="ap-msg is-${t.from}" data-msg="${s}"${t.mood?` data-mood="${t.mood}"`:""}><p>${n(t.text)}</p></li>`).join("");return`<section class="ap-agent" id="luna" aria-labelledby="ap-agent-title">
    <div class="ap-agent-head">
      <p class="ap-eyebrow ap-reveal">${n(c("start.agent_eyebrow"))}</p>
      <h2 class="ap-h2 ap-reveal" id="ap-agent-title">${n(c("start.agent_title"))}</h2>
      <p class="ap-sub ap-reveal">${n(c("start.agent_text"))}</p>
    </div>
    <div class="ap-agent-stage ap-reveal">
      <div class="ap-agent-avatar" data-avatar>${q("ruhe",280,c("start.tile_luna_label"))}</div>
      <div class="ap-chat" data-chat>
        <div class="ap-chat-head">
          <span class="ap-chat-face" aria-hidden="true">${q("ruhe",40,"",{still:!0})}</span>
          <div><p class="ap-chat-name">${n(c("start.agent_name"))}</p><p class="ap-chat-role">${n(c("start.agent_role"))}</p></div>
          <p class="ap-chat-time">${n(c("start.agent_time"))}</p>
        </div>
        <ol class="ap-chat-list" role="log" aria-label="${n(c("start.agent_label"))}">${e}<li class="ap-msg is-luna is-typing" data-typing aria-hidden="true"><p><i></i><i></i><i></i></p></li></ol>
        <div class="ap-chat-input" aria-hidden="true"><span>${n(c("start.agent_input"))}</span><i></i></div>
      </div>
    </div>
  </section>`}function Hs(){return`<section class="ap-free" aria-labelledby="ap-free-title">
    <p class="ap-free-count" data-count role="img" aria-label="${n(c("start.free_label"))}">0,00 €</p>
    <p class="ap-free-lesson ap-reveal">${n(c("start.free_lesson"))}</p>
    <h2 class="ap-free-title ap-reveal" id="ap-free-title">${n(c("start.free_title"))}</h2>
    <p class="ap-free-text ap-reveal">${n(c("start.free_text"))}</p>
  </section>`}function Ts(){return`<section class="ap-privacy" aria-labelledby="ap-privacy-title">
    ${pe(c("start.lock_label"),"ap-lock")}
    <h2 class="ap-h2 ap-reveal" id="ap-privacy-title">${n(c("start.privacy_title"))}</h2>
    <p class="ap-sub ap-reveal">${n(c("start.privacy_text"))}</p>
    <a class="ap-link ap-reveal" href="/privacy-philosophy">${n(c("start.privacy_link"))}${I}</a>
  </section>`}function Bs(){var s;const a=ca(),e=["macos","windows","linux","android","ios"].map(o=>{const l=z[o],r=l.kind==="pwa",i=r?c("start.cta_web"):`${B(l.bytes)} MB`,p=r?`href="${l.href}" data-install="${o}"`:`href="${l.href}" download data-install="${o}"`;return`<li><a class="ap-platform${o===a?" is-yours":""}" ${p}>
      <span class="ap-platform-mark">${K(o,30)}</span>
      <span class="ap-platform-name">${n(P[o])}</span>
      <span class="ap-platform-meta">${n(i)}</span>
    </a></li>`}).join(""),{button:t}=xa();return`<section class="ap-get" id="laden" aria-labelledby="ap-get-title">
    <h2 class="ap-get-title ap-reveal" id="ap-get-title">${n(c("start.get_title"))}</h2>
    <p class="ap-sub ap-reveal">${n(c("start.get_text"))}</p>
    <ul class="ap-platforms ap-reveal">${e}</ul>
    <div class="ap-get-cta ap-reveal">${t}<a class="ap-link" href="/download">${n(c("start.get_all"))}${I}</a></div>
    <p class="ap-fine">${n(c("start.fine"))}</p>
    <p class="ap-fine ap-footnote">${n(((s=z[a])==null?void 0:s.kind)==="pwa"?c("start.footnote_iserv_web",{device:Ma(a)}):c("start.footnote_iserv"))}</p>
    <p class="ap-fine ap-footnote">${n(c("start.footnote_agent"))}</p>
    <p class="ap-fine ap-footnote">${n(c("start.footnote_account"))}</p>
  </section>`}function js(a){const e=a.querySelector(".ap-hero"),t=a.querySelector("[data-hero-copy]"),s=a.querySelector("[data-hero-device]");return requestAnimationFrame(()=>requestAnimationFrame(()=>e.classList.add("is-ready"))),A()?()=>{}:ne(e,(o,l)=>{const r=na(-o.top/(l*.75));t.style.opacity=String(na(1-r*1.35)),t.style.translate=`0 ${(-r*70).toFixed(1)}px`,s.style.scale=String((1+r*.07).toFixed(4))},"0%")}function Is(a){const e=[...a.querySelectorAll(".ap-step")],t=a.querySelector("[data-show-device]");if(!e.length||!t)return()=>{};if(matchMedia("(min-width: 735px)").matches)for(const l of t.querySelectorAll(".mac-shot"))l.loading="eager";const s=l=>{for(const r of e)r.classList.toggle("is-active",r===l);Ce(t,l.dataset.step)},o=new IntersectionObserver(l=>{for(const r of l)r.isIntersecting&&s(r.target)},{rootMargin:"-48% 0px -48% 0px"});return e.forEach(l=>o.observe(l)),()=>o.disconnect()}function Os(a){const e=a.querySelector("[data-chat]"),t=a.querySelector("[data-avatar]");if(!e||!t)return()=>{};const s=[...e.querySelectorAll("[data-msg]")],o=e.querySelector("[data-typing]"),l=c("start.tile_luna_label");if(A()||!("IntersectionObserver"in window))return s.forEach(y=>y.classList.add("is-in")),()=>{};const r=[],i=(y,m)=>r.push(setTimeout(m,y)),p=getComputedStyle(t).getPropertyValue("--ap-ease").trim()||"ease",d=y=>{const m=t.querySelector(".luna:not(.is-leaving)");m!=null&&m.classList.contains(`is-${y}`)||(t.insertAdjacentHTML("beforeend",q(y,280,l)),m&&(m.classList.add("is-leaving"),m.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(0.94)"}],{duration:480,easing:p,fill:"forwards"}).finished.catch(()=>{}).then(()=>m.remove()),t.lastElementChild.animate([{opacity:0,transform:"scale(1.06)"},{opacity:1,transform:"none"}],{duration:480,easing:p})))},f=y=>y.classList.add("is-in"),M=()=>{let y=0;s.forEach(m=>{if(m.classList.contains("is-me")){i(y,()=>f(m)),y+=700;return}i(y,()=>{o.classList.add("is-in"),d("laedt")}),y+=1250,i(y,()=>{o.classList.remove("is-in"),f(m),d(m.dataset.mood==="cheer"?"geschafft":"ruhe")}),y+=m.dataset.mood==="cheer"?1900:1300,m.dataset.mood==="cheer"&&i(y-300,()=>d("ruhe"))})},S=new IntersectionObserver(y=>{y.some(m=>m.isIntersecting)&&(S.disconnect(),M())},{threshold:.45});return S.observe(e),()=>{S.disconnect(),r.forEach(clearTimeout)}}function Ds(a){const e=a.querySelector("[data-count]");if(!e)return()=>{};const t=G()==="de"?"de-DE":"en-IE",s=new Intl.NumberFormat(t,{style:"currency",currency:"EUR"}),o=new Intl.NumberFormat(t,{style:"currency",currency:"EUR",minimumFractionDigits:0,maximumFractionDigits:0}).format(0);e.textContent=s.format(0);const l=()=>{e.textContent=o,e.classList.add("is-zero")};if(A()||!("IntersectionObserver"in window))return l(),()=>{};let r=0;const i=49.99,p=1150,d=160,f=1500,M=g=>g<.5?4*g*g*g:1-Math.pow(-2*g+2,3)/2,S=g=>1-Math.pow(1-g,4),y=g=>{const _=k=>{const b=k-g;let H;if(b<p)H=i*M(b/p);else if(b<p+d)H=i;else if(b<p+d+f)H=i*(1-S((b-p-d)/f));else return l();e.textContent=s.format(Math.round(H*100)/100),e.classList.toggle("is-counting",!0),r=requestAnimationFrame(_)};r=requestAnimationFrame(_)},m=new IntersectionObserver(g=>{g.some(_=>_.isIntersecting)&&(m.disconnect(),y(performance.now()))},{threshold:.6});return m.observe(e),()=>{m.disconnect(),cancelAnimationFrame(r)}}const Fs={title:()=>c("meta.home"),render:()=>`<div class="ap">${Es()}${qs()}${Ls()}${zs()}${Cs()}${Hs()}${Ts()}${Bs()}</div>`,mount(a){const e=[js(a),Se(a.querySelector("[data-words]"),a.querySelector("[data-statement]")),Is(a),Q(a,".ap-reveal, .hl"),ls(a),Ms(a),Os(a),Ds(a),de(a),ie(a)];return()=>e.forEach(t=>t&&t())}},Pa={sand:"#E7C694",salbei:"#A3B690",slate:"#6295D4",iris:"#B7A6F6",plum:"#AC7DC0",lake:"#4FBADE"},Na={stundenplan:["plan",[336,84,620,501],700],noten:["noten",[980,28,372,456],420],aufgaben:["aufgaben",[316,14,660,600],700],iserv:["plan",[976,64,380,382],440],fahrplan:["bus",[976,64,380,560],420],kalender:["kalender",[316,220,660,540],700]};function Rs(a,e){const[t,s,o]=Na[a.id]||Na.stundenplan,l=(a.facts||[]).map(r=>`<li>${n(r)}</li>`).join("");return`<article class="ap-feature${e%2?" is-flipped":""}" style="--hue: ${Pa[a.hue]||Pa.sand}" aria-labelledby="feature-${a.id}">
    <div class="ap-feature-copy">
      <p class="ap-feature-eyebrow ap-reveal">${n(a.title)}</p>
      <h2 class="ap-feature-title ap-reveal" id="feature-${a.id}">${n(c(`features_page.heads.${a.id}`))}</h2>
      <p class="ap-feature-text ap-reveal">${n(a.text)}</p>
      <ul class="ap-facts ap-reveal">${l}</ul>
      <p class="ap-devices ap-reveal">${n(c(`home_features.devices_${a.devices}`))}</p>
    </div>
    ${a.id==="luna"?`<div class="ap-feature-luna ap-reveal">${q("ruhe",280,c("start.tile_luna_label"))}</div>`:Qt(t,s,c(`features_page.shots.${a.id}`),{max:o})}
  </article>`}function fa(a){const e=c(`features_page.${a==="yes"?"yes":a==="partial"?"partial":"no"}`);return a==="yes"?`<span class="ap-state is-yes">${u("check",{size:20,stroke:2.6})}<span class="sr-only">${n(e)}</span></span>`:a==="partial"?`<span class="ap-state is-partial">${n(e)}</span>`:`<span class="ap-state is-no" aria-label="${n(e)}">–</span>`}function Vs(){const a=$("features_page.groups")||[],e=`<thead><tr>
    <th scope="col"><span class="sr-only">${n(c("features_page.col_feature"))}</span></th>
    <th scope="col"><span class="ap-col">${u("monitor",{size:28,stroke:1.6})}<span>${n(c("features_page.col_desk"))}</span></span></th>
    <th scope="col"><span class="ap-col">${X("android",{size:28})}<span>${n(c("features_page.col_android"))}</span></span></th>
    <th scope="col"><span class="ap-col">${X("apple",{size:28})}<span>${n(c("features_page.col_ios"))}</span></span></th>
  </tr></thead>`,t=a.map(s=>`<tbody>
    <tr class="ap-table-group"><th colspan="4" scope="colgroup">${n(s.title)}</th></tr>
    ${s.rows.map(o=>`<tr>
      <th scope="row"><span class="ap-table-name">${n(o.name)}</span>${o.note?`<span class="ap-table-note">${n(o.note)}</span>`:""}</th>
      <td>${fa(o.d)}</td><td>${fa(o.a)}</td><td>${fa(o.i)}</td>
    </tr>`).join("")}
  </tbody>`).join("");return`<table class="ap-table ap-reveal"><caption class="sr-only">${n(c("features_page.matrix_title"))}</caption>${e}${t}</table>`}const Ps={title:()=>c("meta.features"),description:()=>c("meta.desc.features"),render:()=>{const a=$("home_features.areas")||[],e=$("features_page.new_items")||[];return`<div class="ap ap-sub-page">
      ${ra({eyebrow:c("features_page.eyebrow"),title:c("features_page.hero_title"),lede:c("features_page.hero_lede")})}
      <div class="ap-page-device ap-reveal">${la([{id:"plan",alt:c("features_page.hero_alt")}],{eager:!0,phone:"phone-plan"})}</div>
      <section class="ap-features" aria-label="${n(c("features_page.eyebrow"))}">${a.map(Rs).join("")}</section>
      <section class="ap-matrix" aria-labelledby="matrix-title">
        <h2 class="ap-h2 ap-reveal" id="matrix-title">${n(c("features_page.matrix_title"))}</h2>
        ${Vs()}
        <p class="ap-note ap-reveal">${n(c("features_page.ios_note"))}</p>
      </section>
      <section class="ap-news" aria-labelledby="news-title">
        <h2 class="ap-h2 ap-reveal" id="news-title">${n(c("features_page.new_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("features_page.new_lede"))}</p>
        <ul class="ap-cards">${e.map(t=>`<li class="ap-card ap-reveal"><h3>${n(t.title)}</h3><p>${n(t.text)}</p></li>`).join("")}</ul>
      </section>
      <section class="ap-cta" aria-labelledby="cta-title">
        <h2 class="ap-cta-title ap-reveal" id="cta-title">${n(c("features_page.cta_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("features_page.cta_text"))}</p>
        <div class="ap-cta-row ap-reveal"><a class="ap-btn" href="/download">${n(c("download_page.get"))}</a><a class="ap-link" href="/privacy-philosophy">${n(c("start.privacy_link"))}${I}</a></div>
      </section>
    </div>`},mount:a=>Q(a,".ap-reveal")};function Ns(a){return`<li class="ap-flow ${a.tone==="cancel"?"is-off":a.tone==="warn"?"is-warn":""} ap-reveal">
    <span class="ap-flow-icon">${u(a.icon,{size:22,stroke:1.8})}</span>
    <span class="ap-flow-to">${n(a.to)}</span>
    <span class="ap-flow-what">${n(a.what)}</span>
    <span class="ap-flow-when">${n(a.when)}</span>
  </li>`}const Ys={title:()=>c("meta.privacy"),description:()=>c("meta.desc.privacy"),render:()=>{const a=$("privacy_page.where")||[],e=$("privacy_page.flow")||[],t=$("privacy_page.no")||[];return`<div class="ap ap-sub-page">
      ${ra({eyebrow:c("privacy_page.eyebrow"),title:c("privacy_page.title"),lede:c("privacy_page.lede"),top:pe(c("privacy_page.lock_label"),"ap-lock")})}
      <section class="ap-sec" aria-labelledby="where-title">
        <h2 class="ap-h2 ap-reveal" id="where-title">${n(c("privacy_page.where_title"))}</h2>
        <ul class="ap-cards">${a.map(s=>`<li class="ap-card ap-reveal"><span class="ap-card-icon">${u(s.icon,{size:30,stroke:1.6})}</span><h3>${n(s.title)}</h3><p>${n(s.text)}</p></li>`).join("")}</ul>
      </section>
      <section class="ap-sec" aria-labelledby="flow-title">
        <h2 class="ap-h2 ap-reveal" id="flow-title">${n(c("privacy_page.flow_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("privacy_page.flow_lede"))}</p>
        <ul class="ap-flows">${e.map(Ns).join("")}</ul>
      </section>
      <section class="ap-sec ap-big-number" aria-labelledby="lock-title">
        <h2 class="ap-h2 ap-reveal" id="lock-title">${n(c("privacy_page.lock_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("privacy_page.lock_text"))}</p>
        <div class="ap-stat ap-reveal">
          <p class="ap-number">${n(c("privacy_page.lock_number"))}</p>
          <p class="ap-number-label">${n(c("privacy_page.lock_number_label"))}</p>
        </div>
      </section>
      <section class="ap-sec" aria-labelledby="no-title">
        <h2 class="ap-h2 ap-reveal" id="no-title">${n(c("privacy_page.no_title"))}</h2>
        <ul class="ap-nolist ap-reveal">${t.map(s=>`<li>${u("ban",{size:22,stroke:1.8})}<span>${n(s)}</span></li>`).join("")}</ul>
      </section>
      <section class="ap-cta" aria-labelledby="open-title">
        <h2 class="ap-cta-title ap-reveal" id="open-title">${n(c("privacy_page.open_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("privacy_page.open_text"))}</p>
        <div class="ap-cta-row ap-reveal"><a class="ap-btn" href="${oa}" target="_blank" rel="noopener">${X("github",{size:18})}<span>${n(c("privacy_page.open_link"))}</span></a><a class="ap-link" href="/datenschutz">${n(c("privacy_page.legal_link"))}${I}</a></div>
      </section>
    </div>`},mount(a){const e=[Q(a,".ap-reveal"),de(a)];return()=>e.forEach(t=>t&&t())}};function Us(a,e){const t=z[a],s=t.kind==="pwa",o=a===e,l=$(`steps.${a}`)||[],r=`curl -sL https://${La}/install-macos.sh | bash`,i=`<span>curl -sL</span> <span>https://</span><wbr><span>${n(La)}/</span><wbr><span>install-macos.sh</span> <span>| bash</span>`,p=s?`<a class="ap-btn${o?"":" ap-btn-ghost"}" href="${t.href}">${n(c("download_page.open"))}</a>`:`<a class="ap-btn${o?"":" ap-btn-ghost"}" href="${t.href}" download data-download="${a}">${n(c("download_page.get"))}</a>`;return`<article class="ap-dl${o?" is-yours":""} ap-reveal" id="${a}" aria-labelledby="dl-${a}">
    <div class="ap-dl-top">
      <span class="ap-dl-mark">${K(a,34)}</span>
      ${o?`<span class="ap-dl-badge">${n(c("download_page.yours"))}</span>`:""}
    </div>
    <h2 class="ap-dl-name" id="dl-${a}">${n(c(`platforms.${a}.name`))}</h2>
    <p class="ap-dl-note">${n(c(`platforms.${a}.note`))}</p>
    <p class="ap-dl-meta">${s?n(c("start.cta_web")):`${n(t.file)}, ${B(t.bytes)} MB`}</p>
    <div class="ap-dl-action">${p}</div>
    ${t.alt?`<p class="ap-dl-meta">${n(c(`platforms.${a}.alt`))} <a href="${t.alt.href}" download>${n(t.alt.file)}, ${B(t.alt.bytes)}&nbsp;MB</a></p>`:""}
    <ol class="ap-dl-steps">${l.map(d=>`<li>${le(d)}</li>`).join("")}</ol>
    ${a==="macos"?`<div class="ap-cmd"><p>${n(c("steps.macos_terminal"))}</p><div class="ap-cmd-row"><code>${i}</code><button type="button" class="ap-copy" data-copy="${n(r)}">${u("copy",{size:15})}<span>${n(c("steps.copy"))}</span></button></div></div>`:""}
  </article>`}const Xs={title:()=>c("meta.download"),description:()=>c("meta.desc.download"),render:()=>{const a=ca(),e=se(),t=p=>e.includes(p)?e.indexOf(p):e.length,s=[...ae].sort((p,d)=>t(p)-t(d)),o=$("download_page.faq")||[],{button:l,note:r}=xa(),i=`<div class="ap-hero-cta ap-reveal">${l}</div>
      <p class="ap-hero-note ap-reveal">${n(r)}</p>
      <p class="ap-page-note ap-reveal">${n(c("download_page.name_note"))}</p>`;return`<div class="ap ap-sub-page">
      ${ra({eyebrow:c("download_page.eyebrow"),title:c("download_page.hero_title"),lede:c("download_page.lede"),extra:i})}
      <section class="ap-sec ap-dls" aria-label="${n(c("download_page.eyebrow"))}">${s.map(p=>Us(p,a)).join("")}</section>
      <section class="ap-sec ap-faqs" aria-labelledby="faq-title">
        <h2 class="ap-h2 ap-reveal" id="faq-title">${n(c("download_page.faq_title"))}</h2>
        <div class="ap-faq-list ap-reveal">${o.map(p=>`<details class="ap-faq"><summary><span>${n(p.q)}</span><i class="ap-faq-plus" aria-hidden="true"></i></summary><p>${n(p.a)}</p></details>`).join("")}</div>
      </section>
    </div>`},mount(a){const e=[Q(a,".ap-reveal"),ie(a)];return()=>e.forEach(t=>t&&t())}},Ks={title:()=>c("meta.about"),description:()=>c("meta.desc.about"),render:()=>{const a=$("about_page.story")||[],e=$("about_page.open")||[];return`<div class="ap ap-sub-page">
      ${ra({eyebrow:c("about_page.eyebrow"),title:c("about_page.title"),lede:c("about_page.lede")})}
      <div class="ap-page-device ap-reveal">${la([{id:"heute",alt:c("about_page.shot_alt")}],{eager:!0,phone:"phone-heute",phoneAlt:c("about_page.shot_alt_phone")})}</div>
      <section class="ap-sec ap-story" aria-labelledby="story-title">
        <h2 class="ap-h2 ap-reveal" id="story-title">${n(c("about_page.story_title"))}</h2>
        <div class="ap-story-text">${a.map(t=>`<p class="ap-reveal">${n(t)}</p>`).join("")}</div>
      </section>
      <section class="ap-sec" aria-labelledby="open-title">
        <h2 class="ap-h2 ap-reveal" id="open-title">${n(c("about_page.open_title"))}</h2>
        <ul class="ap-cards">${e.map(t=>`<li class="ap-card ap-reveal"><h3>${n(t.title)}</h3><p>${n(t.text)}</p></li>`).join("")}</ul>
      </section>
      <section class="ap-cta" aria-labelledby="contact-title">
        <h2 class="ap-cta-title ap-reveal" id="contact-title">${n(c("about_page.contact_title"))}</h2>
        <p class="ap-sub ap-reveal">${n(c("about_page.contact_text"))}</p>
        <div class="ap-cta-row ap-reveal"><a class="ap-btn" href="mailto:${ta}?subject=${encodeURIComponent(E)}">${n(c("about_page.contact_button"))}</a><a class="ap-link" href="${oa}" target="_blank" rel="noopener">${n(c("about_page.code_button"))}${I}</a></div>
      </section>
    </div>`},mount:a=>Q(a,".ap-reveal")},ma=`<a class="prose-link" href="mailto:${ta}">${ta}</a>`,Ws=a=>n(a).replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g,'<a class="prose-link" href="$2" target="_blank" rel="noopener">$1</a>');function Zs(a){const e=$(a)||{},t=new Map;for(const[s,o]of Object.entries(e)){const l=s.match(/^(s\d+)_(.+)$/);l&&(t.has(l[1])||t.set(l[1],[]),t.get(l[1]).push([l[2],o]))}return t}function Gs(a,e,t){var i;let s="",o=[];const l=()=>{o.length&&(s+=`<ul>${o.map(p=>`<li>${n(p)}</li>`).join("")}</ul>`),o=[]},r=((i=t.find(([p])=>p==="title"))==null?void 0:i[1])||"";for(let p=0;p<t.length;p++){const[d,f]=t[p];if(d!=="title"){if(/^list\d+$/.test(d)){o.push(f);continue}if(l(),/^sub\d+_title$/.test(d))s+=`<h3>${n(f)}</h3>`;else if(d==="name")s+=`<p class="legal-name"><strong>${n(f)}</strong></p>`;else if(d==="email_label")s+=`<p>${n(f)} ${ma}</p>`;else{if(d==="link")continue;if(/^p\d+$/.test(d)||/^sub\d+_p\d+$/.test(d)){const M=t.find(([S])=>S==="link");M&&d==="p1"&&a==="terms"&&e==="s6"?s+=`<p>${n(f)} <a class="prose-link" href="/datenschutz">${n(M[1])}</a>.</p>`:s+=`<p>${Ws(f)}</p>`,a==="terms"&&e==="s8"&&d==="p1"&&(s+=`<p>${ma}</p>`),a==="privacy_policy"&&e==="s7"&&d==="p1"&&(s+=`<p class="legal-name"><strong>${n(c("privacy_policy.s1_name"))}</strong></p><p>${ma}</p>`)}}}}return l(),`<section class="legal-section" id="${e}" aria-labelledby="${e}-title"><h2 id="${e}-title">${n(r)}</h2>${s}</section>`}function he(a,e){const t=Zs(a),s=[...t.entries()].map(([l,r])=>{var i;return`<li><a href="#${l}">${n(((i=r.find(([p])=>p==="title"))==null?void 0:i[1])||l)}</a></li>`}).join(""),o=[...t.entries()].map(([l,r])=>Gs(a,l,r)).join("");return`<article class="legal wrap">
    <header class="legal-head" data-reveal>
      <h1>${n(c(`${a}.hero_title`))}</h1>
      <p class="legal-date mono">${n(c(`${a}.hero_date`))}</p>
    </header>
    <div class="legal-grid">
      <nav class="legal-toc" aria-label="${n(c("legal.toc"))}" data-reveal style="--i:1">
        <p class="legal-toc-title">${n(c("legal.toc"))}</p>
        <ol>${s}</ol>
        <a class="legal-other" href="${e.href}">${u("arrow-right",{size:15})}<span>${n(c(e.key))}</span></a>
      </nav>
      <div class="legal-body" data-reveal="fade" style="--i:1">${o}</div>
    </div>
  </article>`}const Qs={theme:"light",title:()=>c("meta.terms"),description:()=>c("meta.desc.terms"),render:()=>he("terms",{href:"/datenschutz",key:"legal.other_privacy"}),mount:a=>Ja(a)},Js={theme:"light",title:()=>c("meta.privacy_policy"),description:()=>c("meta.desc.privacy_policy"),render:()=>he("privacy_policy",{href:"/nutzungsbedingungen",key:"legal.other_terms"}),mount:a=>Ja(a)},Sa={"/":Fs,"/features":Ps,"/privacy-philosophy":Ys,"/download":Xs,"/about":Ks,"/nutzungsbedingungen":Qs,"/datenschutz":Js},ya=document.getElementById("app"),an=document.getElementById("site-header"),Ya=document.getElementById("site-footer"),C=document.getElementById("mobile-menu"),ia=document.querySelector("[data-menu-open]"),Y=document.querySelector('meta[name="description"]'),en=(Y==null?void 0:Y.content)||"";let Ua=()=>{},Z=null;const ue=a=>{const e=a.replace(/\/index\.html$/,"/").replace(/\/+$/,"")||"/";return Sa[e]?e:"/"};function tn(a){document.querySelectorAll("[data-nav]").forEach(e=>{e.getAttribute("href")===a?e.setAttribute("aria-current","page"):e.removeAttribute("aria-current")})}function fe(){const a=G()==="de"?"en":"de";document.querySelectorAll("[data-lang-toggle]").forEach(e=>{const t=e.classList.contains("lang-toggle-wide");e.textContent=t?c(`lang.name_${a}`):a.toUpperCase(),e.setAttribute("aria-label",c("lang.switch")),e.setAttribute("lang",a)})}function Ea(a,{hash:e="",focus:t=!1}={}){const s=Sa[a];if(Ua(),document.body.dataset.route=a==="/"?"home":a.slice(1),document.body.dataset.theme=s.theme||"dark",ya.innerHTML=s.render(),Ya.innerHTML=be(),_e(Ya),document.title=s.title?s.title():E,Y&&(Y.content=s.description?s.description():en),tn(a),Ua=s.mount?s.mount(ya)||(()=>{}):()=>{},Z=a,e){const o=document.getElementById(decodeURIComponent(e.slice(1)));o?(requestAnimationFrame(()=>o.scrollIntoView({block:"center"})),o.classList.add("is-target")):scrollTo(0,0)}else scrollTo(0,0);t&&ya.focus({preventScroll:!0})}function me(a,{push:e=!0}={}){const t=new URL(a,location.href),s=ue(t.pathname);e&&history.pushState({},"",s+t.hash),O();const o=()=>Ea(s,{hash:t.hash,focus:e});document.startViewTransition&&!A()&&Z!==s?document.startViewTransition(o):o()}document.addEventListener("click",a=>{var o;const e=a.target.closest("a[href]");if(!e||a.defaultPrevented||a.button!==0||a.metaKey||a.ctrlKey||a.shiftKey||a.altKey||e.target&&e.target!=="_self"||e.hasAttribute("download"))return;const t=new URL(e.href,location.href);if(t.origin!==location.origin)return;const s=t.pathname.replace(/\/+$/,"")||"/";if(Sa[s]){if(a.preventDefault(),s===Z&&t.hash){history.pushState({},"",s+t.hash),(o=document.getElementById(decodeURIComponent(t.hash.slice(1))))==null||o.scrollIntoView({behavior:A()?"auto":"smooth",block:"start"}),O();return}if(s===Z&&!t.hash){O(),scrollTo({top:0,behavior:A()?"auto":"smooth"});return}me(t.href)}});addEventListener("popstate",()=>me(location.href,{push:!1}));document.addEventListener("click",a=>{a.target.closest("[data-lang-toggle]")&&ve(G()==="de"?"en":"de")});$e(()=>{Qa(),fe();const a=scrollY;Ea(Z||"/"),scrollTo(0,a)});function sn(){var a;C.hidden=!1,requestAnimationFrame(()=>C.classList.add("is-open")),ia.setAttribute("aria-expanded","true"),document.body.classList.add("menu-open"),(a=C.querySelector("a"))==null||a.focus({preventScroll:!0})}function O(){if(C.hidden)return;C.classList.remove("is-open"),ia.setAttribute("aria-expanded","false"),document.body.classList.remove("menu-open");const a=()=>{C.classList.contains("is-open")||(C.hidden=!0)};A()?a():setTimeout(a,260)}ia.addEventListener("click",()=>C.hidden?sn():O());document.addEventListener("keydown",a=>{a.key==="Escape"&&!C.hidden&&(O(),ia.focus())});matchMedia("(min-width: 900px)").addEventListener("change",a=>{a.matches&&O()});let _a=!1;function ye(){_a=!1,an.classList.toggle("is-scrolled",scrollY>8)}addEventListener("scroll",()=>{_a||(_a=!0,requestAnimationFrame(ye))},{passive:!0});Qa();fe();Ea(ue(location.pathname),{hash:location.hash});ye();
