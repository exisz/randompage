#!/usr/bin/env node
import fs from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), process.argv[i + 1]);
  i += 1;
}

function required(name) {
  const value = args.get(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(2);
  }
  return value;
}

function normalizeFingerprint(value) {
  const hex = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (hex.length !== 64) {
    throw new Error(`Expected a SHA-256 certificate fingerprint (64 hex chars), got ${value}`);
  }
  return hex.match(/.{2}/g).join(':');
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function parseApksignerFingerprint(path) {
  const text = fs.readFileSync(path, 'utf8');
  const match = text.match(/SHA-256(?: digest)?:\s*([A-Fa-f0-9:]+)/i);
  if (!match) throw new Error(`Could not find SHA-256 certificate fingerprint in ${path}`);
  return normalizeFingerprint(match[1]);
}

function assertAssetlinks(assetlinks, { packageName, fingerprint, label }) {
  const entries = Array.isArray(assetlinks) ? assetlinks : [];
  const found = entries.some((entry) => {
    const target = entry?.target ?? {};
    const fingerprints = Array.isArray(target.sha256_cert_fingerprints)
      ? target.sha256_cert_fingerprints.map(normalizeFingerprint)
      : [];
    return target.namespace === 'android_app'
      && target.package_name === packageName
      && fingerprints.includes(fingerprint);
  });
  if (!found) {
    throw new Error(`${label} does not contain package ${packageName} with fingerprint ${fingerprint}`);
  }
}

const packageName = required('package');
const host = required('host');
const fingerprint = parseApksignerFingerprint(required('fingerprint-file'));
const assetlinksPath = required('assetlinks');
const manifestPath = required('manifest');
const twaManifestPath = required('twa-manifest');

assertAssetlinks(readJson(assetlinksPath), {
  packageName,
  fingerprint,
  label: assetlinksPath,
});

const manifest = readJson(manifestPath);
if (manifest.display !== 'standalone' && manifest.display !== 'fullscreen') {
  throw new Error(`${manifestPath} display must be standalone/fullscreen, got ${manifest.display}`);
}
if (manifest.scope !== '/') {
  throw new Error(`${manifestPath} scope must be /, got ${manifest.scope}`);
}
if (manifest.start_url !== '/discover') {
  throw new Error(`${manifestPath} start_url must be /discover, got ${manifest.start_url}`);
}

const twa = readJson(twaManifestPath);
if (twa.packageId !== packageName) throw new Error(`${twaManifestPath} packageId mismatch: ${twa.packageId}`);
if (twa.host !== host) throw new Error(`${twaManifestPath} host mismatch: ${twa.host}`);
if (twa.startUrl !== '/discover') throw new Error(`${twaManifestPath} startUrl mismatch: ${twa.startUrl}`);
if (twa.fullScopeUrl !== `https://${host}/`) throw new Error(`${twaManifestPath} fullScopeUrl mismatch: ${twa.fullScopeUrl}`);
if (Array.isArray(twa.fingerprints) && twa.fingerprints.length > 0) {
  const twaFingerprints = twa.fingerprints.map(normalizeFingerprint);
  if (!twaFingerprints.includes(fingerprint)) {
    throw new Error(`${twaManifestPath} fingerprints does not include ${fingerprint}`);
  }
}

const hostedUrl = args.get('hosted-url');
if (hostedUrl) {
  try {
    const res = await fetch(hostedUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hosted = await res.json();
    assertAssetlinks(hosted, { packageName, fingerprint, label: hostedUrl });
    console.log(`Hosted assetlinks OK: ${hostedUrl}`);
  } catch (error) {
    if (process.env.ALLOW_HOSTED_ASSETLINKS_LAG === '1') {
      console.warn(`Hosted assetlinks check skipped/lagging: ${error.message}`);
    } else {
      throw error;
    }
  }
}

console.log(`TWA verification OK: ${packageName} @ ${host} fingerprint ${fingerprint}`);
