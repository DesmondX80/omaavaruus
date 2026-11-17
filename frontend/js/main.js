// Käynnistys: kytkee näkymät yhteen ja ajastaa päivitykset.
import { state, el } from './core.js';
import { initCalendar, tickCountdowns } from './calendar.js';
import { events } from './events.js';
import { initInfo } from './info.js';
import { iss, initIss } from './iss.js';
import { launches } from './launches.js';
import { initNav, VIEWS } from './nav.js';
import { initNight } from './night.js';
import { initNow } from './now.js';
import { initPlaces } from './places.js';
import { initPush, renderPush } from './push.js';
import { initSheets } from './sheets.js';
import { initSky, sky } from './sky.js';
import { initSolarSystem } from './solarsystem.js';
import { redrawMap, solarwind } from './solarwind.js';
import { auroraHistory, renderCameras, sunStatus, weather } from './weather.js';

initNight(); initInfo(); initSheets(); initNow(); initCalendar(); initSky(); initSolarSystem(); initIss(); initNav();
setInterval(tickCountdowns,1000);
el('time-offset').addEventListener('change',e=>{state.offset=Number(e.target.value); sky();});
launches(); sunStatus();
initPush();
solarwind();
await initPlaces(()=>{weather(); auroraHistory(); renderCameras(); sky(); events(); iss(); redrawMap(); renderPush();});
setInterval(weather,300000); setInterval(auroraHistory,3600000); setInterval(sunStatus,1800000); setInterval(solarwind,300000); setInterval(iss,60000); setInterval(sky,60000); setInterval(events,6*3600000);
// Yhteyden palatessa tiedot haetaan heti eikä vasta seuraavalla ajastetulla kierroksella.
window.addEventListener('online',()=>{weather(); sky(); events(); solarwind(); iss();});
// Service worker tekee sovelluksesta asennettavan ja pitää viimeksi haetut tiedot saatavilla ilman verkkoa.
if('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service workerin rekisteröinti epäonnistui:',e));
  // Ilmoituksen napautus avoimessa sovelluksessa vaihtaa ilmoituksen näkymään (sw.js).
  navigator.serviceWorker.addEventListener('message',e=>{if(VIEWS.includes(e.data?.view)) location.hash=`#${e.data.view}`;});
}
