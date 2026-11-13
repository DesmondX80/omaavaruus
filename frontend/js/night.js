// Yövalaistus: punainen, himmeä näyttö pimeänäön säästämiseksi (tyylit styles.css:ssä). Valinta tallentuu selaimeen.
import { el, saved } from './core.js';

const KEY = 'omaavaruus.night';

function apply(on) {
  document.documentElement.classList.toggle('nightvision', on);
  el('night-toggle').setAttribute('aria-pressed', String(on));
  // Selaimen ja puhelimen palkkien väri: musta yötilassa, muuten sovelluksen tausta.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#000000' : '#05070f');
}

export function initNight() {
  apply(saved.get(KEY, false) === true);
  el('night-toggle').addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('nightvision');
    saved.set(KEY, on); apply(on);
  });
}
