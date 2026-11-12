// Käynnistys: kytkee kortit yhteen ja ajastaa päivitykset.
import { state, el } from './core.js';
import { initInfo } from './info.js';
import { launches, renderLaunches } from './launches.js';
import { initPlaces } from './places.js';
import { sky } from './sky.js';
import { weather } from './weather.js';

function clock() {el('clock').textContent=new Date().toLocaleString('fi-FI'); renderLaunches();}

initInfo(); clock(); setInterval(clock,1000);
el('time-offset').addEventListener('change',e=>{state.offset=Number(e.target.value); sky();});
launches();
await initPlaces(()=>{weather(); sky();});
setInterval(weather,300000); setInterval(sky,60000);
// Yhteyden palatessa tiedot haetaan heti eikä vasta seuraavalla ajastetulla kierroksella.
window.addEventListener('online',()=>{weather(); sky();});
// Service worker tekee sovelluksesta asennettavan ja pitää viimeksi haetut tiedot saatavilla ilman verkkoa.
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service workerin rekisteröinti epäonnistui:',e));
