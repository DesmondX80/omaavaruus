// Paikan valinta: oma sijainti (GPS) tai nimellä haettu paikka.
import { state, el, json, saved, button } from './core.js';

// Kutsutaan, kun havaintopaikka vaihtuu ja paikasta riippuvat tiedot pitää hakea uudelleen.
let onChange = () => {};

const validPlace = p => p && typeof p.name==='string' && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
const samePlace = (a,b) => a.name===b.name && Math.abs(a.lat-b.lat)<0.01 && Math.abs(a.lon-b.lon)<0.01;
export const placeLabel = () => state.place ? state.place.name : state.gps ? 'Oma sijainti' : `${state.fallback.name} (oletus)`;
function renderPlaces() {
  el('place-name').textContent=`Paikka: ${placeLabel()}`;
  const item = (label, current, onPick, onRemove) => {
    const li=document.createElement('li'), pick=button('pick',label,onPick);
    pick.setAttribute('aria-current',String(current)); li.append(pick);
    if(onRemove) {const x=button('remove','✕',onRemove); x.setAttribute('aria-label',`Poista ${label}`); li.append(x);}
    return li;
  };
  el('place-list').replaceChildren(
    item(state.gps?'Oma sijainti':`Oma sijainti (paikannus ei käytössä: ${state.fallback.name})`, !state.place, ()=>selectPlace(null)),
    ...state.places.map(p=>item(p.name, state.place===p, ()=>selectPlace(p), ()=>removePlace(p))),
  );
}
// Asettaa havaintopaikan valinnan mukaan ja hakee paikasta riippuvat tiedot uudelleen.
function applyPlace() {
  const p=state.place ?? state.gps ?? state.fallback;
  state.lat=p.lat; state.lon=p.lon; state.hour=null;
  renderPlaces(); onChange();
}
function selectPlace(place) {
  state.place=place; saved.set('omaavaruus.selected', place?state.places.indexOf(place):null);
  togglePanel(false); applyPlace();
}
function removePlace(place) {
  const selected=state.place===place;
  state.places=state.places.filter(p=>p!==place); saved.set('omaavaruus.places',state.places);
  if(selected) selectPlace(null);
  else {saved.set('omaavaruus.selected', state.place?state.places.indexOf(state.place):null); renderPlaces();}
}
function togglePanel(open) {
  el('place-panel').hidden=!open; el('place-toggle').setAttribute('aria-expanded',String(open));
  el('place-toggle').textContent=open?'Sulje':'Vaihda paikka';
  if(open) el('place-query').focus(); else {clearTimeout(searchTimer); searchSeq++; el('place-results').replaceChildren(); el('place-status').textContent='';}
}
// Ehdotukset haetaan kirjoittamisen aikana. Vanhat ehdotukset pysyvät näkyvissä, kunnes uudet saapuvat,
// ja järjestysnumero estää hitaamman vanhan vastauksen korvaamasta uudempaa.
let searchSeq=0, searchTimer=null;
function suggestPlaces(delay) {
  clearTimeout(searchTimer);
  const query=el('place-query').value.trim();
  if(query.length<2) {searchSeq++; el('place-results').replaceChildren(); el('place-status').textContent=''; return;}
  searchTimer=setTimeout(()=>searchPlaces(query),delay);
}
async function searchPlaces(query) {
  const seq=++searchSeq;
  if(!el('place-results').childElementCount) el('place-status').textContent='Haetaan…';
  try {
    const {results}=await json(`/api/geocode?q=${encodeURIComponent(query)}`);
    if(seq!==searchSeq) return;
    el('place-status').textContent=results.length?'Valitse paikka:':`Paikkaa ”${query}” ei löytynyt.`;
    el('place-results').replaceChildren(...results.filter(validPlace).map(r=>{
      const li=document.createElement('li'), detail=document.createElement('small');
      const pick=button('pick',r.name,()=>{
        const place=state.places.find(p=>samePlace(p,r)) ?? {name:r.name, lat:r.lat, lon:r.lon};
        if(!state.places.includes(place)) {state.places.push(place); saved.set('omaavaruus.places',state.places);}
        clearTimeout(searchTimer); searchSeq++; el('place-query').value=''; selectPlace(place);
      });
      detail.textContent=[r.region,r.country].filter(Boolean).join(', ');
      if(detail.textContent) pick.append(' ',detail);
      li.append(pick); return li;
    }));
  } catch(e) {if(seq===searchSeq) {el('place-results').replaceChildren(); el('place-status').textContent=e.message;}}
}
export async function initPlaces(changed) {
  onChange=changed;
  el('place-toggle').addEventListener('click',()=>togglePanel(el('place-panel').hidden));
  el('place-search').addEventListener('submit',e=>{e.preventDefault(); suggestPlaces(0);});
  el('place-query').addEventListener('input',()=>suggestPlaces(250));
  const stored=saved.get('omaavaruus.places',[]);
  state.places=Array.isArray(stored)?stored.filter(validPlace).map(p=>({name:p.name, lat:p.lat, lon:p.lon})):[];
  state.place=state.places[saved.get('omaavaruus.selected',null)] ?? null;
  try {const c=await json('/api/config'); state.fallback={name:c.default_place, lat:c.default_lat, lon:c.default_lon};} catch(e) {console.warn(e);}
  applyPlace();
  if(navigator.geolocation) {
    // Tarkka paikannus (GPS, jos saatavilla). Haetaan uudelleen vain, jos sijainti siirtyy yli 200 m.
    const moved=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180))>200;
    navigator.geolocation.watchPosition(p=>{
      const gps={lat:p.coords.latitude, lon:p.coords.longitude, accuracy:p.coords.accuracy};
      const refresh=!state.gps||moved(gps,state);
      state.gps=gps;
      // Valittu paikka pysyy voimassa; oma sijainti päivittyy taustalla sitä varten, että siihen palataan.
      if(state.place) renderPlaces(); else if(refresh) applyPlace();
    },e=>console.warn('Paikannus epäonnistui:',e.message), {enableHighAccuracy:true, timeout:15000, maximumAge:60000});
  }
}
