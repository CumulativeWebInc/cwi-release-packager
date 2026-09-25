'use strict';
/* CWI Release Asset Packager unit tests — node:test, zero deps. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const rp = require('./release-packager.js');

const OK_TRACK = { id: 'trk_12', title: 'Zooted Zone', artist: 'That Boy Hi Hat', isrc: 'QZDA52303345', isrc_status: 'verified' };
const NO_ISRC = { id: 'trk_27', title: 'piv-ot-al', artist: 'That Boy Hi Hat', isrc: null, isrc_status: 'unverified' };
const CONFLICTED = { id: 'trk_15', title: 'Shaka Zulu', artist: 'That Boy Hi Hat', isrc: null, isrc_status: 'conflicted' };
const BAD_ISRC = { id: 'trk_x', title: 'X', artist: 'Y', isrc: 'ABC123', isrc_status: 'verified' };

test('engine exposes version + schema', () => {
  assert.equal(rp.version, '1.0.0');
  assert.equal(rp.schema, 'cwi.release-bundle/1.0');
});

test('UMD loads in a browser-like global context', () => {
  const src = fs.readFileSync(path.join(ROOT, 'release-packager.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.equal(sandbox.CWIReleasePackager.version, '1.0.0');
  assert.equal(typeof sandbox.CWIReleasePackager.buildBundle, 'function');
});

test('verified track with attested art + future date -> gate PASS', () => {
  const b = rp.buildBundle(OK_TRACK, { releaseDate: '2030-01-15', coverArtAttested: true, upc: '198000000000' });
  assert.equal(b.schema, 'cwi.release-bundle/1.0');
  assert.equal(b.gate, 'PASS');
  assert.ok(b.checks.every(c => c.hard ? c.status === 'PASS' : true));
  const isrcCheck = b.checks.find(c => c.id === 'isrc_present');
  assert.equal(isrcCheck.status, 'PASS');
  assert.equal(isrcCheck.truth, 'VERIFIED');
});

test('missing ISRC fails CLOSED: gate FAIL with red-gate note', () => {
  const b = rp.buildBundle(NO_ISRC, {});
  assert.equal(b.gate, 'FAIL');
  assert.ok(b.gate_note.includes('RED GATE'), 'gate note must name the red gate');
  assert.ok(b.checks.find(c => c.id === 'isrc_present').status === 'FAIL');
  const s = rp.summarize(b);
  assert.ok(s.hard_fails.includes('isrc_present'));
  assert.ok(s.hard_fails.includes('isrc_status_verified'));
});

test('conflicted ISRC fails CLOSED', () => {
  const b = rp.buildBundle(CONFLICTED, {});
  assert.equal(b.gate, 'FAIL');
  const st = b.checks.find(c => c.id === 'isrc_status_verified');
  assert.equal(st.status, 'FAIL');
  assert.ok(st.detail.includes('conflict'), 'detail must explain the conflict');
});

test('malformed ISRC fails the format check', () => {
  const b = rp.buildBundle(BAD_ISRC, {});
  assert.equal(b.gate, 'FAIL');
  assert.equal(b.checks.find(c => c.id === 'isrc_format').status, 'FAIL');
});

test('empty title fails closed', () => {
  const b = rp.buildBundle({ id: 'z', title: '', artist: 'A', isrc: 'QZDA52303345', isrc_status: 'verified' }, {});
  assert.equal(b.gate, 'FAIL');
  assert.equal(b.checks.find(c => c.id === 'title_present').status, 'FAIL');
});

test('missing artist fails closed', () => {
  const b = rp.buildBundle({ id: 'z', title: 'T', artist: null, isrc: 'QZDA52303345', isrc_status: 'verified' }, {});
  assert.equal(b.gate, 'FAIL');
  assert.equal(b.checks.find(c => c.id === 'artist_present').status, 'FAIL');
});

test('cover art without attestation is WARN + USER-level truth handling', () => {
  const b = rp.buildBundle(OK_TRACK, {});
  const c = b.checks.find(x => x.id === 'cover_art_spec');
  assert.equal(c.status, 'WARN');
  assert.equal(c.truth, 'UNVERIFIED');
  // gate still PASS: soft check does not block
  assert.equal(b.gate, 'PASS');
  const b2 = rp.buildBundle(OK_TRACK, { coverArtAttested: true });
  const c2 = b2.checks.find(x => x.id === 'cover_art_spec');
  assert.equal(c2.status, 'PASS');
  assert.equal(c2.truth, 'USER-ATTESTED');
});

test('T-6wk window: 60 days out passes, 10 days out warns without blocking', () => {
  const fmt = d => d.toISOString().slice(0, 10);
  const far = new Date(Date.now() + 60 * 86400000);
  const near = new Date(Date.now() + 10 * 86400000);
  const bFar = rp.buildBundle(OK_TRACK, { releaseDate: fmt(far) });
  assert.equal(bFar.checks.find(c => c.id === 't6wk_window').status, 'PASS');
  const bNear = rp.buildBundle(OK_TRACK, { releaseDate: fmt(near) });
  assert.equal(bNear.checks.find(c => c.id === 't6wk_window').status, 'WARN');
  assert.equal(bNear.gate, 'PASS', 'freeze-window warning must not block the gate');
});

test('truthFor: catalog-backed = VERIFIED, cover art needs attestation, upc always UNVERIFIED', () => {
  assert.equal(rp.truthFor('isrc_present', { catalogSnapshot: true }), 'VERIFIED');
  assert.equal(rp.truthFor('isrc_present', { catalogSnapshot: false }), 'UNVERIFIED');
  assert.equal(rp.truthFor('cover_art_spec', { attested: true }), 'USER-ATTESTED');
  assert.equal(rp.truthFor('cover_art_spec', { attested: false }), 'UNVERIFIED');
  assert.equal(rp.truthFor('upc_present', { catalogSnapshot: true }), 'UNVERIFIED');
});

test('data/tracks.json: 52 records, unique ids, every record sourced + status in vocabulary', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tracks.json'), 'utf8'));
  assert.equal(doc.schema, 'cwi.release-track/1.0');
  assert.ok(doc.source.includes('catalog-index.json'));
  const ids = new Set();
  for (const r of doc.records) {
    assert.ok(r.id && r.title && r.artist, 'record missing identity: ' + r.id);
    assert.ok(['verified', 'conflicted', 'unverified'].includes(r.isrc_status), 'bad status: ' + r.id);
    assert.ok(!ids.has(r.id), 'duplicate id: ' + r.id);
    ids.add(r.id);
    if (r.isrc) assert.ok(/^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(r.isrc), 'bad isrc format baked in: ' + r.id);
    else assert.ok(r.isrc_status !== 'verified', 'verified track without isrc: ' + r.id);
  }
  assert.equal(doc.records.length, 52);
});

test('data snapshot matches the real catalog-index conflict set', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tracks.json'), 'utf8'));
  const conflicts = doc.records.filter(r => r.isrc_status === 'conflicted').map(r => r.title).sort();
  assert.deepEqual(conflicts, ['Golden Diamond', 'Shaka Zulu']);
  const missing = doc.records.filter(r => r.isrc_status === 'unverified').map(r => r.title).sort();
  assert.deepEqual(missing, ['On Edge', 'Pay Yourself', 'Sync Ready Tracks', 'piv-ot-al']);
});

test('bundle.schema.json carries the cwi.release-bundle/1.0 const', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'bundle.schema.json'), 'utf8'));
  assert.equal(s.properties.schema.const, 'cwi.release-bundle/1.0');
});

test('cli/build.js exists and builds a bundle', () => {
  const src = fs.readFileSync(path.join(ROOT, 'cli', 'build.js'), 'utf8');
  assert.ok(src.includes('buildBundle'));
  assert.ok(src.includes('track-id'));
});

test('no secret-shaped values baked into the repo files', () => {
  const files = ['release-packager.js', 'data/tracks.json', 'bundle.schema.json', 'cli/build.js'];
  const secretRe = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|xox[bap]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!secretRe.test(src), 'secret-shaped value in ' + f);
  }
});

test('engine truth vocabulary is VERIFIED / UNVERIFIED / USER-ATTESTED only', () => {
  assert.deepEqual(Object.values(rp.TRUTH).sort(), ['UNVERIFIED', 'USER-ATTESTED', 'VERIFIED']);
});

test('summarize counts and hard-fail list are consistent', () => {
  const b = rp.buildBundle(NO_ISRC, {});
  const s = rp.summarize(b);
  assert.equal(s.gate, 'FAIL');
  assert.ok(s.counts.FAIL >= 2);
  assert.deepEqual(s.hard_fails.sort(), ['isrc_format', 'isrc_present', 'isrc_status_verified'].sort());
});
