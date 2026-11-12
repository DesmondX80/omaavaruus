import { describe, expect, it } from "vitest";

import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from "../src/webpush";

describe("web push", () => {
  it("salaa viestin kuten RFC 8291:n esimerkki (liite A)", async () => {
    const senderPublic = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const body = await encryptPayload(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
        senderJwk: {
          kty: "EC",
          crv: "P-256",
          d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
          x: b64urlEncode(senderPublic.slice(1, 33)),
          y: b64urlEncode(senderPublic.slice(33)),
        },
      },
    );
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("tekee VAPID-tunnisteen, jonka allekirjoitus täsmää julkiseen avaimeen", async () => {
    const vapid = await generateVapidKeys();
    const auth = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, "https://example.test/", Date.UTC(2026, 10, 12));
    const [, token, publicKey] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(publicKey).toBe(vapid.publicKey);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(claims)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.UTC(2026, 10, 12) / 1000 + 43200,
      sub: "https://example.test/",
    });
    const key = await crypto.subtle.importKey("raw", b64urlDecode(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlDecode(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});
