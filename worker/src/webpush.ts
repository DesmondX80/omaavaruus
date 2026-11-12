/**
 * Web Push -viestin lähetys Workerin WebCryptolla: sisällön salaus (RFC 8291, aes128gcm)
 * ja palvelimen tunnistus push-palvelulle (VAPID, RFC 8292).
 */

export interface PushTarget {
  endpoint: string;
  /** Selaimen julkinen avain (p256dh) ja tunnistussalaisuus (auth), base64url. */
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Julkinen avain pakkaamattomana pisteenä (65 tavua), base64url: sama arvo annetaan selaimelle tilausta tehdessä. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

const encoder = new TextEncoder();

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

const EC = { name: "ECDH", namedCurve: "P-256" } as const;

/** Pakkaamaton P-256-piste (0x04 || x || y) JWK:n koordinaateista. */
function rawPublicKey(jwk: JsonWebKey): Uint8Array {
  return concat(Uint8Array.of(4), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!));
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(rawPublicKey(privateJwk)), privateJwk };
}

/**
 * Salaa viestin vastaanottajan avaimille (RFC 8291). Suola ja lähettäjän kertakäyttöinen avain arvotaan
 * joka viestille; ne voi antaa vain testissä, jotta tulosta voi verrata RFC:n esimerkkiin.
 */
export async function encryptPayload(
  payload: Uint8Array,
  keys: PushTarget["keys"],
  fixed?: { salt: Uint8Array; senderJwk: JsonWebKey },
): Promise<Uint8Array> {
  const receiverPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4) throw new Error("Virheellinen p256dh-avain");
  if (authSecret.length !== 16) throw new Error("Virheellinen auth-salaisuus");

  let senderPrivate: CryptoKey, senderJwk: JsonWebKey;
  if (fixed) {
    senderJwk = fixed.senderJwk;
    senderPrivate = await crypto.subtle.importKey("jwk", senderJwk, EC, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey(EC, true, ["deriveBits"])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  }
  const senderPublic = rawPublicKey(senderJwk);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const receiverKey = await crypto.subtle.importKey("raw", receiverPublic, EC, false, []);
  // Workers-tyypit nimeävät kentän "$public", vaikka ajonaikainen WebCrypto käyttää standardin "public"-nimeä.
  const ecdh = { name: "ECDH", public: receiverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, senderPrivate, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic), 32);
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // Yksi tietue: sisältö ja viimeisen tietueen merkki 0x02.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(payload, Uint8Array.of(2))),
  );
  // Otsake: suola (16), tietueen koko (4, big-endian 4096), avaimen pituus (1), lähettäjän julkinen avain (65).
  return concat(salt, Uint8Array.of(0, 0, 0x10, 0), Uint8Array.of(senderPublic.length), senderPublic, ciphertext);
}

/** VAPID-tunniste: ES256-allekirjoitettu JWT, joka on sidottu push-palvelun osoitteeseen ja voimassa 12 tuntia. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** Lähettää viestin push-palvelulle ja palauttaa sen HTTP-tilan (201 = vastaanotettu, 404/410 = tilaus poistunut). */
export async function sendPush(target: PushTarget, payload: unknown, vapid: VapidKeys, subject: string, ttlS: number): Promise<number> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), target.keys);
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlS),
      Urgency: "high",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return response.status;
}
