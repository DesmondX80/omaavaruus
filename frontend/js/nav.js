// Näkymien vaihto: osoitteen #-osa valitsee näkymän, joten selaimen takaisin-painike ja suorat linkit toimivat.
import { el } from './core.js';

export const VIEWS = ['nyt','revontulet','taivas','iss','kalenteri'];
export const currentView = () => VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : VIEWS[0];

function route() {
  const name=currentView();
  for(const v of VIEWS) el(`view-${v}`).hidden = v!==name;
  for(const a of el('nav').querySelectorAll('a')) a.getAttribute('href')===`#${name}` ? a.setAttribute('aria-current','page') : a.removeAttribute('aria-current');
  window.scrollTo(0,0);
  // Piilossa ollut kartta piirretään näkyvän kokonsa mukaan vasta, kun näkymä on esillä.
  document.dispatchEvent(new CustomEvent('viewchange',{detail:name}));
}

export function initNav() { window.addEventListener('hashchange',route); route(); }
