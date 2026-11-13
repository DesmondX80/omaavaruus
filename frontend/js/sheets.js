// Alhaalta nouseva paneeli: paikan valinta, ilmoitusasetukset ja ⓘ-selitykset. Yksi paneeli on auki kerrallaan.
import { el } from './core.js';

const BODIES = ['place','notify','info'];
const TITLES = {place:'Paikka', notify:'Ilmoitukset'};
let opener = null;

export function openSheet(name, title=TITLES[name]) {
  opener ??= document.activeElement;
  for(const b of BODIES) el(`sheet-${b}`).hidden = b!==name;
  el('sheet-title').textContent=title;
  el('scrim').hidden=false; document.body.classList.add('sky-locked');
  el('sheet').scrollTop=0; el('sheet-close').focus();
}

export function closeSheet() {
  if(el('scrim').hidden) return;
  el('scrim').hidden=true;
  // Koko näytön kartta pitää sivun vierityksen lukittuna itse.
  if(!document.querySelector('.sky-full, .iss-full')) document.body.classList.remove('sky-locked');
  document.dispatchEvent(new Event('sheetclose'));
  opener?.focus?.(); opener=null;
}

export function initSheets() {
  el('sheet-close').addEventListener('click',closeSheet);
  el('scrim').addEventListener('click',e=>{if(e.target===el('scrim')) closeSheet();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape') closeSheet();});
  // Mikä tahansa painike, jolla on data-sheet, avaa nimetyn paneelin.
  document.addEventListener('click',e=>{const b=e.target.closest('[data-sheet]'); if(b) openSheet(b.dataset.sheet);});
}
