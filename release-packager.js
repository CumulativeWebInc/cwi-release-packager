'use strict';
/* CWI Release Asset Packager — distributor deliverable bundle builder.
 * Zero-dep UMD: works in Node (require) and browsers (window.CWIReleasePackager).
 * Given a track + release date + asset attestations, it assembles the
 * distributor deliverable bundle and fails CLOSED (red gate) on missing or
 * conflicted ISRCs. Truth is VERIFIED only for checks run against the
 * catalog-index snapshot; everything else is UNVERIFIED by construction.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CWIReleasePackager = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const VERSION = '1.0.0';
  const SCHEMA = 'cwi.release-bundle/1.0';
  const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/;
  const FREEZE_DAYS = 42; // T-6wk distributor freeze window

  const TRUTH = {
    VERIFIED: 'VERIFIED',
    UNVERIFIED: 'UNVERIFIED',
    USER_ATTESTED: 'USER-ATTESTED'
  };

  function truthFor(checkId, context) {
    // context: { catalogSnapshot: bool, attested: bool }
    if (checkId === 'cover_art_spec') return context && context.attested ? TRUTH.USER_ATTESTED : TRUTH.UNVERIFIED;
    if (checkId === 'upc_present') return TRUTH.UNVERIFIED; // UPC lives in the distributor dashboard, not this snapshot
    if (checkId === 't6wk_window') return TRUTH.UNVERIFIED; // calendar arithmetic on user input
    return context && context.catalogSnapshot ? TRUTH.VERIFIED : TRUTH.UNVERIFIED;
  }

  function norm(s) { return (s === null || s === undefined) ? '' : String(s).trim(); }

  function checkTrack(track, opts) {
    opts = opts || {};
    const ctx = { catalogSnapshot: true, attested: !!opts.coverArtAttested };
    const checks = [];

    // 1. title present (hard)
    const title = norm(track.title);
    checks.push({
      id: 'title_present', hard: true,
      status: title ? 'PASS' : 'FAIL',
      truth: truthFor('title_present', ctx),
      detail: title ? 'Title present: "' + title + '"' : 'FAIL: no track title — a release cannot ship untitled.'
    });

    // 2. artist present (hard)
    const artist = norm(track.artist);
    checks.push({
      id: 'artist_present', hard: true,
      status: artist ? 'PASS' : 'FAIL',
      truth: truthFor('artist_present', ctx),
      detail: artist ? 'Artist present: "' + artist + '"' : 'FAIL: no artist — distributor metadata rejects artistless releases.'
    });

    // 3. ISRC present (hard — fails closed)
    const isrc = norm(track.isrc);
    checks.push({
      id: 'isrc_present', hard: true,
      status: isrc ? 'PASS' : 'FAIL',
      truth: truthFor('isrc_present', ctx),
      detail: isrc ? 'ISRC present: ' + isrc
        : 'FAIL (RED GATE): no ISRC on record. A release can never ship past this gate without its identifier — obtain or assign one first.'
    });

    // 4. ISRC status verified, never conflicted (hard — fails closed)
    const st = norm(track.isrc_status);
    let stStatus = 'FAIL';
    let stDetail = 'FAIL (RED GATE): ISRC status is "' + (st || 'unknown') + '" — not verified. Resolve before ship.';
    if (st === 'verified' && isrc) { stStatus = 'PASS'; stDetail = 'ISRC status verified in the catalog-index snapshot.'; }
    else if (st === 'conflicted') {
      stStatus = 'FAIL';
      stDetail = 'FAIL (RED GATE): conflicting ISRC values across sources (dashboard vs Deezer). Dashboards arbitrate per standing rule — resolve the conflict before this release ships.';
    }
    checks.push({ id: 'isrc_status_verified', hard: true, status: stStatus, truth: truthFor('isrc_status_verified', ctx), detail: stDetail });

    // 5. ISRC format (hard)
    const fmtOK = isrc !== '' && ISRC_RE.test(isrc);
    checks.push({
      id: 'isrc_format', hard: true,
      status: fmtOK ? 'PASS' : 'FAIL',
      truth: truthFor('isrc_format', ctx),
      detail: fmtOK ? 'ISRC format valid (CC-XXX-YY-NNNNN).' : 'FAIL: ISRC "' + (isrc || '—') + '" does not match the 12-character ISRC pattern.'
    });

    // 6. cover art spec (user attestation — never silently trusted)
    const attested = !!opts.coverArtAttested;
    checks.push({
      id: 'cover_art_spec', hard: false,
      status: attested ? 'PASS' : 'WARN',
      truth: truthFor('cover_art_spec', ctx),
      detail: attested
        ? 'Cover art spec attested by the packager (3000×3000 px, RGB, no blur/pixelation, no URL watermarks). USER-ATTESTED — this tool does not inspect the file.'
        : 'WARN: cover art spec not attested. Distributors reject below-spec artwork at the freeze.'
    });

    // 7. UPC (soft — distributor-assigned in many flows)
    const upc = norm(opts.upc);
    checks.push({
      id: 'upc_present', hard: false,
      status: upc ? 'PASS' : 'WARN',
      truth: TRUTH.UNVERIFIED,
      detail: upc ? 'UPC supplied: ' + upc + ' (format self-declared, not validated here).'
        : 'WARN: no UPC supplied. Distributors can assign one — confirm who owns the code before the freeze.'
    });

    // 8. T-6wk distributor freeze window (informational)
    const rel = opts.releaseDate ? new Date(opts.releaseDate + 'T00:00:00') : null;
    let freeze = { status: 'WARN', detail: 'WARN: no release date given — the T-6wk freeze window cannot be computed.' };
    if (rel && !isNaN(rel)) {
      const days = Math.round((rel - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / 86400000);
      if (days < 0) freeze = { status: 'WARN', detail: 'WARN: release date ' + opts.releaseDate + ' is in the past — check the date.' };
      else if (days < FREEZE_DAYS) freeze = { status: 'WARN', detail: 'WARN: ' + days + ' days to release — inside the T-6wk (' + FREEZE_DAYS + 'd) distributor freeze window. Expedite or move the date.' };
      else freeze = { status: 'PASS', detail: 'Release date ' + opts.releaseDate + ' is ' + days + ' days out — clears the T-6wk distributor freeze window.' };
    }
    checks.push(Object.assign({ id: 't6wk_window', hard: false, truth: TRUTH.UNVERIFIED }, freeze));

    const hardFails = checks.filter(c => c.hard && c.status === 'FAIL');
    const gate = hardFails.length === 0 ? 'PASS' : 'FAIL';

    return {
      schema: SCHEMA,
      engine: 'cwi-release-packager/' + VERSION,
      gate,
      gate_note: gate === 'PASS'
        ? 'All hard checks pass. Bundle is shippable to the distributor deliverable set.'
        : 'RED GATE: ' + hardFails.length + ' hard check(s) failed — ' + hardFails.map(c => c.id).join(', ') + '. This release cannot ship until every red gate clears.',
      track_id: track.id || null,
      title, artist, isrc: isrc || null,
      release_date: opts.releaseDate || null,
      built_at: new Date().toISOString(),
      checks,
      truth_note: 'VERIFIED = checked against the catalog-index snapshot. USER-ATTESTED = packager self-declared. UNVERIFIED = everything else.'
    };
  }

  function summarize(bundle) {
    const by = {};
    bundle.checks.forEach(c => { by[c.status] = (by[c.status] || 0) + 1; });
    return { gate: bundle.gate, counts: by, hard_fails: bundle.checks.filter(c => c.hard && c.status === 'FAIL').map(c => c.id) };
  }

  return { version: VERSION, schema: SCHEMA, TRUTH, buildBundle: checkTrack, summarize, truthFor };
}));
