// Revontulikamerat: valittua paikkaa lähimmät julkiset all-sky-kamerat ja niiden etäisyys ja suunta.
// Kuvia ei näytetä sovelluksessa, koska kameroiden käyttöehdot rajaavat julkisen esittämisen; linkki avaa ylläpitäjän oman sivun.
// Lähteet: Ilmatieteen laitoksen ISES-sivu (koordinaatit ja kuvat), MIRACLE-verkon asemaluettelo, Sodankylän geofysiikan observatorio.

const ISES = 'https://rwc-finland.fmi.fi/index.php/revontulikameroiden-kuvat/';

/** Kamerat: nimi, ylläpitäjä, sijainti ja sivu, jolla uusin kuva näkyy. */
export const CAMERAS = [
  {name:'Kevo', operator:'Ilmatieteen laitos', lat:69.76, lon:27.01, url:ISES},
  {name:'Kilpisjärvi', operator:'Ilmatieteen laitos', lat:69.03, lon:20.47, url:ISES},
  {name:'Muonio', operator:'Ilmatieteen laitos', lat:68.02, lon:23.53, url:ISES},
  {name:'Sodankylä', operator:'Sodankylän geofysiikan observatorio', lat:67.42, lon:26.39, url:'https://www.sgo.fi/Data/Optical/SkyI_SOD_realtime.php'},
  {name:'Kiruna', operator:'Institutet för rymdfysik (Ruotsi)', lat:67.84, lon:20.41, url:'https://www.irf.se/alis/allsky/krn/latest.jpeg'},
  {name:'Nyrölä', operator:'Jyväskylän Sirius ry', lat:62.343, lon:25.510, url:ISES},
  {name:'Hankasalmi', operator:'Jyväskylän Sirius ry', lat:62.254, lon:26.600, url:ISES},
  {name:'Metsähovi', operator:'Aalto-yliopisto', lat:60.218, lon:24.393, url:ISES},
  {name:'Helsinki', operator:'Ilmatieteen laitos', lat:60.204, lon:24.961, url:ISES},
];

const RAD = Math.PI/180, R_EARTH = 6371;
const DIRECTIONS = ['pohjoiseen','koilliseen','itään','kaakkoon','etelään','lounaaseen','länteen','luoteeseen'];

/** Etäisyys (km) ja suunta (astetta pohjoisesta itään) paikasta a paikkaan b isoympyrää pitkin. */
export function distanceBearing(a, b) {
  const p1=a.lat*RAD, p2=b.lat*RAD, dl=(b.lon-a.lon)*RAD;
  const h=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  const km=2*R_EARTH*Math.asin(Math.min(1,Math.sqrt(h)));
  const bearing=(Math.atan2(Math.sin(dl)*Math.cos(p2), Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/RAD+360)%360;
  return {km, bearing, direction:DIRECTIONS[Math.round(bearing/45)%8]};
}

/** Lähimmät kamerat etäisyyden mukaan. */
export function nearestCameras(place, count=3) {
  return CAMERAS.map(c=>({...c, ...distanceBearing(place,c)})).sort((a,b)=>a.km-b.km).slice(0,count);
}
