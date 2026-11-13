// Jaettu tila ja apufunktiot.
// place: käyttäjän valitsema tallennettu paikka (null = oma sijainti); gps: viimeisin paikannus; fallback: API:n oletuspaikka.
export const state = {lat:65.0121, lon:25.4651, offset:0, hour:null, place:null, gps:null, places:[], fallback:{name:'Oulu', lat:65.0121, lon:25.4651}};
export const el = id => document.getElementById(id);
const API = (window.OMAVARUUS_API || "").replace(/\/$/, "");
export const fmt = d => d ? new Date(d).toLocaleString('fi-FI') : 'Aika tarkentuu';
export const hhmm=d=>new Date(d).toLocaleTimeString('fi-FI',{hour:'2-digit',minute:'2-digit'});
export const num=(v,digits=0)=>v.toLocaleString('fi-FI',{maximumFractionDigits:digits});
// Service worker merkitsee välimuistista palautetun API-vastauksen X-Cached-At-otsakkeella (ks. sw.js).
function showOffline(cachedAt) {
  el('offline').hidden=!cachedAt;
  if(cachedAt) el('offline').textContent=`Ei verkkoyhteyttä – näytetään ${fmt(cachedAt)} haetut tiedot`;
}
export async function json(path) {
  const r = await fetch(API + path, {signal:AbortSignal.timeout(45000)});
  showOffline(r.headers.get('X-Cached-At'));
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}
export async function post(path, data) {
  const r = await fetch(API + path, {method:'POST', body:JSON.stringify(data), signal:AbortSignal.timeout(45000)});
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}
// Asetukset tallentuvat tämän selaimen localStorageen.
export const saved = {
  get(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch(e) {return fallback;}},
  set(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch(e) {console.warn('Tallennus epäonnistui');}},
};
export function button(className, text, onClick) {
  const b=document.createElement('button'); b.type='button'; b.className=className; b.textContent=text;
  b.addEventListener('click',onClick); return b;
}

// Viimeksi haetut tiedot kortteja yhdistäville näkymille (Nyt-kooste, kalenteri). Hakija julkaisee tiedot avaimella,
// ja kuuntelijat saavat data-tapahtuman, jonka detail on avain.
export const store = {};
export function publish(key, value) { store[key]=value; document.dispatchEvent(new CustomEvent('data',{detail:key})); }

// Kuvake index.html:n symboleista (i-iss, i-rocket, …).
export function icon(name) {
  const SVG='http://www.w3.org/2000/svg', svg=document.createElementNS(SVG,'svg'), use=document.createElementNS(SVG,'use');
  svg.setAttribute('class','ic'); svg.setAttribute('aria-hidden','true'); use.setAttribute('href',`#i-${name}`); svg.append(use);
  return svg;
}
// Listarivi: kuvake, otsikko ja tarkenteet, oikealla ajankohta. tag on 'div', 'a' (href) tai 'button'.
// details ja when voivat olla tekstiä tai valmiita elementtejä; whenSub on ajankohdan alle tuleva pieni rivi.
export function row({tag='div', href, kind='', iconName, title, details=[], when='', whenSub='', dim=false}) {
  const node=document.createElement(tag), badge=document.createElement('span'), body=document.createElement('span'), time=document.createElement('span');
  node.className=`row${dim?' dim':''}`; if(tag==='button') node.type='button'; if(href) node.href=href;
  badge.className=`badge ${kind}`; badge.append(icon(iconName));
  const b=document.createElement('b'); b.append(...[title].flat()); body.append(b);
  for(const d of details.filter(Boolean)) {
    if(d instanceof Element && d.tagName==='SMALL') {body.append(d); continue;}
    const small=document.createElement('small'); small.append(...[d].flat()); body.append(small);
  }
  time.className='when'; time.append(...[when].flat());
  if(whenSub) {const small=document.createElement('small'); small.append(...[whenSub].flat()); time.append(small);}
  node.append(badge,body,time);
  return node;
}
export const dayLabel = t => new Date(t).toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});

// Pilvisyysennuste tapahtumariville: sama sanallinen asteikko kuin palvelimella (spaceweather.ts, cloudLabel).
// Paksu pilvipeite korostetaan, koska kohde ei silloin todennäköisesti näy. null, kun ennustetta ei ole.
const CLOUD_LABELS = [[15,'selkeää'],[40,'melko selkeää'],[70,'puolipilvistä'],[90,'melko pilvistä'],[101,'pilvistä']];
export function cloudNote(pct) {
  if(pct==null) return null;
  const small=document.createElement('small'), label=CLOUD_LABELS.find(([limit])=>pct<limit)[1];
  small.className=pct>=70 ? 'warn' : '';
  small.textContent=`Ennuste: ${label} (${Math.round(pct)} %)${pct>=90 ? ', ei todennäköisesti näy' : ''}`;
  return small;
}
