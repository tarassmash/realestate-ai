// Покупки в iOS-приложении (StoreKit 2): проверка подписи Apple (JWS) без сторонних библиотек.
// Цепочка x5c: leaf → intermediate → Apple Root CA - G3 (закреплён ниже).
const crypto = require("crypto");
const config = require("./config");

// Apple Root CA - G3 (публичный сертификат, SHA-256 63:34:3A:BF:…:3E:91:79, действует до 2039)
const APPLE_ROOT_G3 = "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";

// В тестах можно подменить корень: APPLE_ROOT_CERTS_B64="base64der,base64der"
const ROOTS = (process.env.APPLE_ROOT_CERTS_B64 || APPLE_ROOT_G3)
  .split(",").map((b) => new crypto.X509Certificate(Buffer.from(b.trim(), "base64")));

// OID-маркеры сертификатов Apple: 1.2.840.113635.100.6.11.1 (leaf) и 1.2.840.113635.100.6.2.1 (intermediate)
const OID_LEAF = Buffer.from("060a2a864886f76364060b01", "hex");
const OID_INTERMEDIATE = Buffer.from("060a2a864886f76364060201", "hex");

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function fail(code) {
  const e = new Error(code);
  e.status = 400;
  e.code = code;
  return e;
}

function verifyJWS(jws) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) throw fail("bad_jws");
  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString("utf8"));
    payload = JSON.parse(b64url(parts[1]).toString("utf8"));
  } catch {
    throw fail("bad_jws");
  }
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw fail("bad_jws");
  let leaf, mid, root;
  try {
    [leaf, mid, root] = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, "base64")));
  } catch {
    throw fail("bad_jws");
  }
  // корень — ровно наш закреплённый сертификат
  if (!ROOTS.some((r) => r.raw.equals(root.raw))) throw fail("untrusted_root");
  // подписи по цепочке
  if (!leaf.verify(mid.publicKey) || !mid.verify(root.publicKey) || !root.verify(root.publicKey)) throw fail("bad_chain");
  if (!leaf.raw.includes(OID_LEAF) || !mid.raw.includes(OID_INTERMEDIATE)) throw fail("bad_chain");
  const now = Date.now();
  for (const c of [leaf, mid, root]) {
    if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw fail("cert_expired");
  }
  const ok = crypto.verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
    b64url(parts[2])
  );
  if (!ok) throw fail("bad_signature");
  return payload;
}

// Товары в App Store Connect: <bundleId>.pack.<id пакета>, например com.realtyphotoai.app.pack.pro
const productIdFor = (packId) => `${config.APPLE_BUNDLE_ID}.pack.${packId}`;
function products() {
  return config.PACKS.map((p) => ({ productId: productIdFor(p.id), packId: p.id, credits: p.credits, popular: !!p.popular }));
}
const packForProduct = (productId) => products().find((p) => p.productId === productId) || null;

// Проверенная транзакция StoreKit 2
function verifyTransaction(jws) {
  const tx = verifyJWS(jws);
  if (tx.bundleId !== config.APPLE_BUNDLE_ID) throw fail("wrong_bundle");
  return tx;
}

module.exports = { verifyJWS, verifyTransaction, products, packForProduct, productIdFor };
