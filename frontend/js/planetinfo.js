// Planeettojen tietokortit Avaruuslentoon: perustiedot ja muutama kiinnostava fakta. Lähteet: NASA Planetary Fact
// Sheet (koko, massa, painovoima, päivän ja vuoden pituus, lämpötila) ja NASA/JPL:n kuuluettelot (tilanne 2025).
// Kuiden määrä kasvaa, kun uusia löydetään.
export const PLANET_INFO = {
  Merkurius: {
    diameter: '4 879 km', mass: '0,055 × Maa', gravity: '3,7 m/s² (0,38 g)', day: '176 vrk (pyörähdys 58,6 vrk)', year: '88 vrk',
    temperature: '−180…+430 °C', atmosphere: 'Lähes olematon: ohut eksosfääri (happea, natriumia, vetyä, heliumia)', moons: 'ei kuita',
    facts: [
      'Yksi aurinkovuorokausi kestää kaksi Merkuriuksen vuotta.',
      'Napa-alueiden kraattereissa on vesijäätä, jota Auringon valo ei koskaan tavoita.',
      'Pienin planeetta, vain vähän suurempi kuin Kuu.',
    ],
  },
  Venus: {
    diameter: '12 104 km', mass: '0,815 × Maa', gravity: '8,87 m/s² (0,90 g)', day: '117 vrk (pyörähdys 243 vrk takaperin)', year: '225 vrk',
    temperature: 'noin +464 °C', atmosphere: '96,5 % hiilidioksidia, paine 92 kertaa Maan, rikkihappopilviä', moons: 'ei kuita',
    facts: [
      'Kuumin planeetta, vaikka Merkurius on lähempänä Aurinkoa: paksu kaasukehä pidättää lämmön.',
      'Venus pyörii takaperin, joten siellä Aurinko nousee lännestä.',
      'Neuvostoliiton Venera 7 laskeutui Venukseen vuonna 1970 ensimmäisenä luotaimena toisen planeetan pinnalle.',
    ],
  },
  Maa: {
    diameter: '12 742 km', mass: '5,97 × 10²⁴ kg', gravity: '9,81 m/s² (1 g)', day: '24 h (pyörähdys 23 h 56 min)', year: '365,25 vrk',
    temperature: 'keskimäärin +15 °C (−89…+57 °C)', atmosphere: '78 % typpeä, 21 % happea', moons: '1 kuu',
    facts: [
      'Ainoa tunnettu planeetta, jolla on elämää ja nestemäistä vettä pinnalla.',
      'Aurinkokunnan tihein planeetta (5,5 g/cm³).',
      'Magneettikenttä suojaa aurinkotuulelta, ja sen hiukkaset synnyttävät revontulet.',
    ],
  },
  Mars: {
    diameter: '6 779 km', mass: '0,107 × Maa', gravity: '3,72 m/s² (0,38 g)', day: '24 h 40 min', year: '687 vrk',
    temperature: 'keskimäärin −63 °C (−140…+20 °C)', atmosphere: '95 % hiilidioksidia, paine alle 1 % Maan paineesta', moons: '2 kuuta: Phobos ja Deimos',
    facts: [
      'Olympus Mons on noin 22 km korkea, aurinkokunnan korkein tulivuori.',
      'Valles Marineris -kanjonijärjestelmä on yli 4 000 km pitkä.',
      'Punainen väri tulee pinnan rautaoksidista eli ruosteesta.',
    ],
  },
  Jupiter: {
    diameter: '139 820 km', mass: '318 × Maa', gravity: '24,8 m/s² (2,5 g) pilvien tasolla', day: '9 h 56 min', year: '11,9 vuotta',
    temperature: 'noin −110 °C pilvien yläpinnalla', atmosphere: 'noin 90 % vetyä ja 10 % heliumia', moons: 'yli 90 kuuta',
    facts: [
      'Massa on kaksi ja puoli kertaa kaikkien muiden planeettojen yhteenlaskettu massa.',
      'Suuri punainen pilkku on Maata suurempi myrsky, jota on seurattu 1830-luvulta asti.',
      'Io on aurinkokunnan tuliperäisin kappale, ja Europan jääkuoren alla on valtameri.',
    ],
  },
  Saturnus: {
    diameter: '116 460 km', mass: '95 × Maa', gravity: '10,4 m/s² (1,07 g) pilvien tasolla', day: '10 h 34 min', year: '29,5 vuotta',
    temperature: 'noin −140 °C pilvien yläpinnalla', atmosphere: 'noin 96 % vetyä ja 3 % heliumia', moons: 'yli 270 kuuta',
    facts: [
      'Saturnuksen keskitiheys on pienempi kuin veden.',
      'Renkaat ovat lähes puhdasta vesijäätä. Niiden läpimitta on noin 280 000 km, mutta paksuus usein vain kymmeniä metrejä.',
      'Suurimmalla kuulla Titanilla on paksu kaasukehä sekä metaani- ja etaanijärviä.',
    ],
  },
  Uranus: {
    diameter: '50 724 km', mass: '14,5 × Maa', gravity: '8,7 m/s² (0,89 g) pilvien tasolla', day: '17 h 14 min (takaperin)', year: '84 vuotta',
    temperature: 'noin −195 °C', atmosphere: 'vetyä, heliumia ja metaania, joka antaa sinivihreän värin', moons: '29 kuuta',
    facts: [
      'Pyörimisakseli on kallistunut 98°, joten Uranus kiertää Aurinkoa kyljellään.',
      'Navoilla vuorottelevat 42 vuoden päivä ja 42 vuoden yö.',
      'Ainoa vierailija on ollut Voyager 2 vuonna 1986.',
    ],
  },
  Neptunus: {
    diameter: '49 244 km', mass: '17,1 × Maa', gravity: '11,2 m/s² (1,14 g) pilvien tasolla', day: '16 h 6 min', year: '165 vuotta',
    temperature: 'noin −200 °C', atmosphere: 'vetyä, heliumia ja metaania', moons: '16 kuuta',
    facts: [
      'Neptunus löydettiin vuonna 1846 laskemalla, missä Uranuksen ratahäiriöt aiheuttava planeetta on.',
      'Aurinkokunnan kovimmat tuulet, jopa 2 000 km/h.',
      'Suurin kuu Triton kiertää takaperin ja on luultavasti Neptunuksen kaappaama Kuiperin vyöhykkeen kappale.',
    ],
  },
};

// Kuut: kiertoaika on samalla kuun vuorokausi, koska kaikki nämä kuut kääntävät aina saman puolen planeettaansa kohti.
const moon = (parent, orbit, rest) => ({parent, orbit, day:'sama kuin kiertoaika (sidottu kierto)', moons:'–', ...rest});
Object.assign(PLANET_INFO, {
  Kuu: moon('Maa','384 400 km Maasta, kierros 27,3 vrk',{
    diameter:'3 474 km', mass:'0,012 × Maa', gravity:'1,62 m/s² (0,17 g)', temperature:'−173…+127 °C', atmosphere:'ei kaasukehää',
    facts:['Kuu kääntää aina saman puolen Maata kohti.','Apollo-ohjelmassa 12 ihmistä käveli Kuussa vuosina 1969–1972.','Kuu loittonee Maasta noin 3,8 cm vuodessa.']}),
  Phobos: moon('Mars','9 376 km Marsin keskipisteestä, kierros 7 h 39 min',{
    diameter:'noin 22 km (epäsäännöllinen)', mass:'1,1 × 10¹⁶ kg', gravity:'0,006 m/s²', temperature:'−112…−4 °C', atmosphere:'ei kaasukehää',
    facts:['Phobos kiertää Marsin nopeammin kuin Mars pyörii, joten Marsista katsottuna se nousee lännestä.','Se lähestyy Marsia ja hajoaa renkaaksi tai törmää planeettaan kymmenien miljoonien vuosien kuluttua.','Stickney-kraatteri on noin 9 km leveä, lähes puolet kuun läpimitasta.']}),
  Io: moon('Jupiter','421 700 km Jupiterista, kierros 1,8 vrk',{
    diameter:'3 643 km', mass:'0,015 × Maa', gravity:'1,80 m/s² (0,18 g)', temperature:'keskimäärin −130 °C, laavat yli +1 000 °C', atmosphere:'ohut, rikkidioksidia',
    facts:['Aurinkokunnan tuliperäisin kappale: yli 400 aktiivista tulivuorta.','Jupiterin vuorovesivoimat venyttävät Iota ja kuumentavat sen sisuksia.','Purkaukset sinkoavat ainetta satojen kilometrien korkeuteen.']}),
  Europa: moon('Jupiter','671 000 km Jupiterista, kierros 3,6 vrk',{
    diameter:'3 122 km', mass:'0,008 × Maa', gravity:'1,31 m/s² (0,13 g)', temperature:'noin −160 °C', atmosphere:'hyvin ohut, happea',
    facts:['Jääkuoren alla on suolainen valtameri, jossa voi olla kaksi kertaa Maan merien vesimäärä.','NASAn Europa Clipper laukaistiin vuonna 2024 tutkimaan, voisiko meressä olla elämää.','Pinta on yksi aurinkokunnan sileimmistä.']}),
  Ganymedes: moon('Jupiter','1 070 000 km Jupiterista, kierros 7,2 vrk',{
    diameter:'5 268 km', mass:'0,025 × Maa', gravity:'1,43 m/s² (0,15 g)', temperature:'noin −160 °C', atmosphere:'hyvin ohut, happea',
    facts:['Aurinkokunnan suurin kuu, läpimitaltaan suurempi kuin Merkurius.','Ainoa kuu, jolla on oma magneettikenttä ja siksi myös revontulia.','ESA:n JUICE-luotain saapuu Jupiterille vuonna 2031 ja asettuu lopulta Ganymedeen kiertoradalle.']}),
  Titan: moon('Saturnus','1 222 000 km Saturnuksesta, kierros 16 vrk',{
    diameter:'5 150 km', mass:'0,023 × Maa', gravity:'1,35 m/s² (0,14 g)', temperature:'noin −179 °C', atmosphere:'paksu: 95 % typpeä ja metaania, paine 1,5 kertaa Maan',
    facts:['Ainoa kuu, jolla on paksu kaasukehä. Siellä sataa metaania, ja pinnalla on metaanijärviä.','Huygens-luotain laskeutui Titanille vuonna 2005.','NASAn Dragonfly-helikopteri on määrä lähettää lentämään Titanin kaasukehässä.']}),
  Enceladus: moon('Saturnus','238 000 km Saturnuksesta, kierros 1,4 vrk',{
    diameter:'504 km', mass:'1,1 × 10²⁰ kg', gravity:'0,11 m/s²', temperature:'noin −198 °C', atmosphere:'vesihöyryä geysireistä',
    facts:['Etelänavan geysirit suihkuavat vettä avaruuteen ja ruokkivat Saturnuksen E-rengasta.','Jäinen pinta heijastaa lähes kaiken valon, joten Enceladus on aurinkokunnan kirkkaimpia kappaleita.','Cassini lensi suihkujen läpi ja löysi niistä suolaa ja orgaanisia yhdisteitä.']}),
  Triton: moon('Neptunus','355 000 km Neptunuksesta, kierros 5,9 vrk takaperin',{
    diameter:'2 707 km', mass:'0,004 × Maa', gravity:'0,78 m/s² (0,08 g)', temperature:'noin −235 °C', atmosphere:'hyvin ohut, typpeä',
    facts:['Triton kiertää takaperin, joten se on luultavasti Neptunuksen kaappaama Kuiperin vyöhykkeen kappale.','Voyager 2 näki vuonna 1989 typpigeysirien jättämiä tummia juovia.','Vuorovesivoimat hidastavat Tritonia, ja se kiertyy hitaasti kohti Neptunusta.']}),
});
