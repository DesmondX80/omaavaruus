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
// Asetukset tallentuvat tämän selaimen localStorageen.
export const saved = {
  get(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch(e) {return fallback;}},
  set(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch(e) {console.warn('Tallennus epäonnistui');}},
};
export function button(className, text, onClick) {
  const b=document.createElement('button'); b.type='button'; b.className=className; b.textContent=text;
  b.addEventListener('click',onClick); return b;
}
