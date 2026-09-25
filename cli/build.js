#!/usr/bin/env node
'use strict';
/* CWI Release Asset Packager CLI — build a deliverable bundle from the shell.
 * Usage: node cli/build.js <track-id> [--release-date YYYY-MM-DD] [--cover-attested] [--upc CODE]
 */
const fs = require('fs');
const path = require('path');
const rp = require('../release-packager.js');

const ROOT = path.join(__dirname, '..');
const tracks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tracks.json'), 'utf8'));

const trackId = process.argv[2];
if (!trackId) {
  console.error('Usage: node cli/build.js <track-id> [--release-date YYYY-MM-DD] [--cover-attested] [--upc CODE]');
  process.exit(2);
}
const track = tracks.records.find(t => t.id === trackId);
if (!track) { console.error('No track with id: ' + trackId); process.exit(2); }

const opts = {};
for (let i = 3; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--release-date') opts.releaseDate = process.argv[++i];
  else if (a === '--cover-attested') opts.coverArtAttested = true;
  else if (a === '--upc') opts.upc = process.argv[++i];
  else { console.error('Unknown arg: ' + a); process.exit(2); }
}

const bundle = rp.buildBundle(track, opts);
const s = rp.summarize(bundle);
console.log(JSON.stringify(bundle, null, 2));
console.error('\nGATE: ' + s.gate + (s.hard_fails.length ? ' — red gates: ' + s.hard_fails.join(', ') : ''));
process.exit(s.gate === 'PASS' ? 0 : 1);
