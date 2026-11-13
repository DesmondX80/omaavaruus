// Laukaisut: lista haetaan 10 minuutin välein ja julkaistaan kalenterille (calendar.js).
// Suosikkitoimijat ja niiden laukaisuilmoitus valitaan ilmoituspaneelista; valinnat tallentuvat selaimeen.
import { el, json, saved, button, publish, store } from './core.js';
import { LAUNCH_KEY, pushActive, syncPush } from './push.js';

export const launchPrefs = () => ({favorites:[], notify:false, ...saved.get(LAUNCH_KEY,{})});
function update(change) {
  saved.set(LAUNCH_KEY,{...launchPrefs(),...change});
  renderFavorites();
  // Kalenteri ja kooste piirtävät suosikkimerkinnät uudelleen.
  if(store.launches) publish('launches',store.launches);
  syncPush();
}
export function toggleFavorite(provider) {
  const {favorites}=launchPrefs();
  update({favorites: favorites.includes(provider) ? favorites.filter(f=>f!==provider) : [...favorites,provider]});
}

// Piirretään vain tilan muuttuessa, jotta kohdistus pysyy painikkeissa.
function renderFavorites() {
  const {favorites, notify}=launchPrefs();
  const providers=[...new Set([...(store.launches?.results ?? []).map(l=>l.provider), ...favorites])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fi'));
  const chips=providers.map(p=>{
    const on=favorites.includes(p), b=button('', `${on?'★':'☆'} ${p}`, ()=>toggleFavorite(p));
    b.setAttribute('aria-pressed',on); return b;
  });
  const title=document.createElement('span');
  title.textContent=providers.length ? 'Suosikkitoimijat (korostetaan kalenterissa):' : 'Toimijat tulevat näkyviin, kun laukaisut on haettu.';
  const options=document.createElement('div'); options.className='favorite-options';
  const label=document.createElement('label'), input=document.createElement('input');
  input.type='checkbox'; input.checked=notify&&pushActive(); input.disabled=!pushActive()||!favorites.length;
  input.addEventListener('change',()=>update({notify:input.checked}));
  label.append(input,' Ilmoita suosikkien laukaisuista noin tuntia ennen'); options.append(label);
  const hint=document.createElement('small');
  hint.textContent=!pushActive() ? 'Ota ensin ilmoitukset käyttöön yllä.' : !favorites.length ? 'Valitse ensin vähintään yksi suosikki.' : '';
  if(hint.textContent) options.append(hint);
  el('launch-favorites').replaceChildren(title,...chips,options);
}

export async function launches() {
  let delay=600000;
  try {publish('launches',{...await json('/api/launches'), stale:false, warning:''});}
  catch(e) {publish('launches',{results:[], updated:null, ...store.launches, stale:true, warning:e.message}); delay=300000;}
  renderFavorites();
  setTimeout(launches,delay);
}
// Ilmoitusten tila ratkaisee, voiko laukaisuilmoitukset valita.
document.addEventListener('pushchange',renderFavorites);
