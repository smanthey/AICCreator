"use strict";

const crypto = require("crypto");

function getKeyBuffer() {
  const raw = process.env.BRAND_SECRETS_KEY || process.env.APP_SECRETS_KEY || "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest(); // 32 bytes
}

function encryptSecret(plain) {
  if (plain == null || plain === "") return null;
  const key = getKeyBuffer();
  if (!key) return `plain:${String(plain)}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("base64")}`;
}

function decryptSecret(value) {
  if (!value) return null;
  const s = String(value);
  if (s.startsWith("plain:")) return s.slice(6);
  if (!s.startsWith("enc:v1:")) return s;
  const key = getKeyBuffer();
  if (!key) throw new Error("BRAND_SECRETS_KEY required to decrypt encrypted secret");

  const [, , ivHex, tagHex, ciphertextB64] = s.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

module.exports = {
  encryptSecret,
  decryptSecret,
};

