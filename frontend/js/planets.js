// Planeettojen sijainnit Auringon ympärillä Keplerin rata-alkioista.
// Alkiot: E. M. Standish (JPL), "Keplerian Elements for Approximate Positions of the Major Planets", taulukko 1,
// voimassa vuosina 1800–2050. Tarkkuus on kaarisekuntien–-minuuttien luokkaa, mikä riittää kartalle reilusti.
// Koordinaatit ovat ekliptikan tasossa (J2000) astronomisina yksikköinä: x kohti kevätpistettä, z ekliptikan pohjoisnavalle.

const RAD = Math.PI/180;
/** Astronominen yksikkö kilometreinä. */
export const AU_KM = 149597870.7;
/** Valon nopeus astronomisina yksikköinä minuutissa. */
export const LIGHT_AU_PER_MIN = 299792.458*60/AU_KM;

// [nimi, väri, säde km, kiertoaika vuosina,
//  a (AU), e, I, L, pitkä periheli ϖ, nousevan solmun pituus Ω (asteina),
//  sama järjestys muutoksina vuosisadassa]
const ELEMENTS = [
  ['Merkurius','#b8b2a8',2439.7,0.2408, 0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593,
    0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081],
  ['Venus','#f2d9a0',6051.8,0.6152, 0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255,
    0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418],
  // Maan alkiot kuvaavat Maan ja Kuun yhteistä painopistettä, joka on alle 5 000 km Maan keskipisteestä.
  ['Maa','#5ed6ff',6371.0,1.0000, 1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0,
    0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0],
  ['Mars','#ff8a65',3389.5,1.8808, 1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891,
    0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343],
  ['Jupiter','#e0b88a',69911,11.862, 5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909,
    -0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106],
  ['Saturnus','#f0d58c',58232,29.457, 9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448,
    -0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794],
  ['Uranus','#9fe3e8',25362,84.011, 19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503,
    -0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589],
  ['Neptunus','#7f9cff',24622,164.79, 30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574,
    0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664],
];

export const PLANETS = ELEMENTS.map(([name,color,radiusKm,periodYears])=>({name,color,radiusKm,periodYears}));
/** Auringon säde kilometreinä. */
export const SUN_RADIUS_KM = 696000;

/** Rata-alkiot hetkellä time (ms): a, e ja kulmat radiaaneina (I, ω = perihelin argumentti, Ω, M = keskianomalia). */
export function elements(name, time) {
  const row=ELEMENTS.find(r=>r[0]===name);
  if(!row) throw new Error(`Tuntematon planeetta: ${name}`);
  const T=(time-Date.UTC(2000,0,1,12))/(36525*86400000), v=i=>row[4+i]+row[10+i]*T;
  const [a,e,I,L,varpi,node]=[0,1,2,3,4,5].map(v);
  return {a, e, I:I*RAD, node:node*RAD, peri:(varpi-node)*RAD, M:((L-varpi)%360)*RAD};
}

/** Eksentrinen anomalia E Keplerin yhtälöstä M = E − e sin E (Newtonin menetelmä). */
export function eccentricAnomaly(M, e) {
  M=Math.atan2(Math.sin(M),Math.cos(M));
  let E=M+e*Math.sin(M);
  for(let i=0;i<20;i++) {
    const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    E-=d;
    if(Math.abs(d)<1e-12) break;
  }
  return E;
}

/** Radan piste eksentrisellä anomalialla E ekliptikan koordinaateissa [x, y, z] (AU). */
export function orbitPoint(el, E) {
  const xp=el.a*(Math.cos(E)-el.e), yp=el.a*Math.sqrt(1-el.e*el.e)*Math.sin(E);
  const cw=Math.cos(el.peri), sw=Math.sin(el.peri), cO=Math.cos(el.node), sO=Math.sin(el.node), cI=Math.cos(el.I), sI=Math.sin(el.I);
  return [
    (cw*cO-sw*sO*cI)*xp+(-sw*cO-cw*sO*cI)*yp,
    (cw*sO+sw*cO*cI)*xp+(-sw*sO+cw*cO*cI)*yp,
    sw*sI*xp+cw*sI*yp,
  ];
}

/** Planeetan sijainti Auringon ympärillä hetkellä time (ms): [x, y, z] astronomisina yksikköinä. */
export function helio(name, time) {
  const el=elements(name,time);
  return orbitPoint(el,eccentricAnomaly(el.M,el.e));
}

/** Kaikkien planeettojen sijainnit ja rata-alkiot hetkellä time. */
export function solarSystem(time) {
  return PLANETS.map(p=>{
    const el=elements(p.name,time), E=eccentricAnomaly(el.M,el.e);
    return {...p, el, E, pos:orbitPoint(el,E)};
  });
}

export const distance = (a, b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
