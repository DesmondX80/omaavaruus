// Planeettojen sijainnit ja nopeudet Auringon ympärillä Keplerin rata-alkioista.
// Alkiot: E. M. Standish (JPL), "Keplerian Elements for Approximate Positions of the Major Planets", taulukot 2a ja 2b,
// voimassa vuosina 3000 eKr.–3000 jKr. Pitkä aikaväli tarvitaan Avaruuslennossa, jossa lento ulkoplaneetoille kestää
// vuosikymmeniä. Ulkoplaneettojen keskianomaliaan lisätään Jupiterin ja Saturnuksen häiriöitä kuvaavat termit b, c, s ja f.
// Tarkkuus on kaariminuuttien luokkaa, mikä riittää kartalle ja lentoradoille reilusti.
// Koordinaatit ovat ekliptikan tasossa (J2000) astronomisina yksikköinä: x kohti kevätpistettä, z ekliptikan pohjoisnavalle.

const RAD = Math.PI/180;
const DAY_MS = 86400000;
const CENTURY_MS = 36525*DAY_MS;
/** Astronominen yksikkö kilometreinä. */
export const AU_KM = 149597870.7;
/** Valon nopeus astronomisina yksikköinä minuutissa. */
export const LIGHT_AU_PER_MIN = 299792.458*60/AU_KM;

// [nimi, väri, säde km, kiertoaika vuosina,
//  a (AU), e, I, L, pitkä periheli ϖ, nousevan solmun pituus Ω (asteina),
//  sama järjestys muutoksina vuosisadassa,
//  keskianomalian lisätermit b, c, s, f (asteina; M += bT² + c cos fT + s sin fT)]
const ELEMENTS = [
  ['Merkurius','#b8b2a8',2439.7,0.2408, 0.38709843,0.20563661,7.00559432,252.25166724,77.45771895,48.33961819,
    0.00000000,0.00002123,-0.00590158,149472.67486623,0.15940013,-0.12214182],
  ['Venus','#f2d9a0',6051.8,0.6152, 0.72332102,0.00676399,3.39777545,181.97970850,131.76755713,76.67261496,
    -0.00000026,-0.00005107,0.00043494,58517.81560260,0.05679648,-0.27274174],
  // Maan alkiot kuvaavat Maan ja Kuun yhteistä painopistettä, joka on alle 5 000 km Maan keskipisteestä.
  ['Maa','#5ed6ff',6371.0,1.0000, 1.00000018,0.01673163,-0.00054346,100.46691572,102.93005885,-5.11260389,
    -0.00000003,-0.00003661,-0.01337178,35999.37306329,0.31795260,-0.24123856],
  ['Mars','#ff8a65',3389.5,1.8808, 1.52371243,0.09336511,1.85181869,-4.56813164,-23.91744784,49.71320984,
    0.00000097,0.00009149,-0.00724757,19140.29934243,0.45223625,-0.26852431],
  ['Jupiter','#e0b88a',69911,11.862, 5.20248019,0.04853590,1.29861416,34.33479152,14.27495244,100.29282654,
    -0.00002864,0.00018026,-0.00322699,3034.90371757,0.18199196,0.13024619,
    -0.00012452,0.06064060,-0.35635438,38.35125000],
  ['Saturnus','#f0d58c',58232,29.457, 9.54149883,0.05550825,2.49424102,50.07571329,92.86136063,113.63998702,
    -0.00003065,-0.00032044,0.00451969,1222.11494724,0.54179478,-0.25015002,
    0.00025899,-0.13434469,0.87320147,38.35125000],
  ['Uranus','#9fe3e8',25362,84.011, 19.18797948,0.04685740,0.77298127,314.20276625,172.43404441,73.96250215,
    -0.00020455,-0.00001550,-0.00180155,428.49512595,0.09266985,0.05739699,
    0.00058331,-0.97731848,0.17689245,7.67025000],
  ['Neptunus','#7f9cff',24622,164.79, 30.06952752,0.00895439,1.77005520,304.22289287,46.68158724,131.78635853,
    0.00006447,0.00000818,0.00022400,218.46515314,0.01009938,-0.00606302,
    -0.00041348,0.68346318,-0.10162547,7.67025000],
];

export const PLANETS = ELEMENTS.map(([name,color,radiusKm,periodYears])=>({name,color,radiusKm,periodYears}));
/** Auringon säde kilometreinä. */
export const SUN_RADIUS_KM = 696000;

/** Rata-alkiot hetkellä time (ms): a, e ja kulmat radiaaneina (I, ω = perihelin argumentti, Ω, M = keskianomalia). */
export function elements(name, time) {
  const row=ELEMENTS.find(r=>r[0]===name);
  if(!row) throw new Error(`Tuntematon planeetta: ${name}`);
  const T=(time-Date.UTC(2000,0,1,12))/CENTURY_MS, v=i=>row[4+i]+row[10+i]*T;
  const [a,e,I,L,varpi,node]=[0,1,2,3,4,5].map(v);
  const [b=0,c=0,s=0,f=0]=row.slice(16);
  const M=L-varpi+b*T*T+c*Math.cos(f*T*RAD)+s*Math.sin(f*T*RAD);
  // n = keskiliikkeen nopeus radiaaneina vuorokaudessa (keskipituuden muutoksesta).
  return {a, e, I:I*RAD, node:node*RAD, peri:(varpi-node)*RAD, M:(M%360)*RAD, n:row[13]*RAD/36525};
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

// Kiertää radan tason vektorin (xp perihelin suuntaan, yp liikkeen suuntaan) ekliptikan koordinaatteihin.
function toEcliptic(el, xp, yp) {
  const cw=Math.cos(el.peri), sw=Math.sin(el.peri), cO=Math.cos(el.node), sO=Math.sin(el.node), cI=Math.cos(el.I), sI=Math.sin(el.I);
  return [
    (cw*cO-sw*sO*cI)*xp+(-sw*cO-cw*sO*cI)*yp,
    (cw*sO+sw*cO*cI)*xp+(-sw*sO+cw*cO*cI)*yp,
    sw*sI*xp+cw*sI*yp,
  ];
}

/** Radan piste eksentrisellä anomalialla E ekliptikan koordinaateissa [x, y, z] (AU). */
export function orbitPoint(el, E) {
  return toEcliptic(el, el.a*(Math.cos(E)-el.e), el.a*Math.sqrt(1-el.e*el.e)*Math.sin(E));
}

/** Planeetan sijainti (AU) ja nopeus (AU/vrk) Auringon ympärillä hetkellä time (ms). */
export function helioState(name, time) {
  const el=elements(name,time), E=eccentricAnomaly(el.M,el.e);
  const dE=el.n/(1-el.e*Math.cos(E));
  return {
    pos:orbitPoint(el,E),
    vel:toEcliptic(el, -el.a*Math.sin(E)*dE, el.a*Math.sqrt(1-el.e*el.e)*Math.cos(E)*dE),
  };
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
