// Käynnistys: kytkee kortit yhteen ja ajastaa päivitykset.
import { state, el } from './core.js';
import { events } from './events.js';
import { initInfo } from './info.js';
import { launches, renderLaunches } from './launches.js';
import { initPlaces } from './places.js';
import { initPush, renderPush } from './push.js';
import { initSky, sky } from './sky.js';
import { weather } from './weather.js';

function clock() {el('clock').textContent=new Date().toLocaleString('fi-FI'); renderLaunches();}

initInfo(); initSky(); clock(); setInterval(clock,1000);
el('time-offset').addEventListener('change',e=>{state.offset=Number(e.target.value); sky();});
launches();
initPush();
await initPlaces(()=>{weather(); sky(); events(); renderPush();});
setInterval(weather,300000); setInterval(sky,60000); setInterval(events,6*3600000);
// Yhteyden palatessa tiedot haetaan heti eikä vasta seuraavalla ajastetulla kierroksella.
window.addEventListener('online',()=>{weather(); sky(); events();});
// Service worker tekee sovelluksesta asennettavan ja pitää viimeksi haetut tiedot saatavilla ilman verkkoa.
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service workerin rekisteröinti epäonnistui:',e));
