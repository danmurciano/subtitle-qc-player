/* ==========================================================================
   SRT and SCC support. Like WebVTT (vtt.js), each file is turned into
   equivalent TTML as it is read, so the checks and the player work unchanged.

   SRT: timing, line breaks, <i>/<b>/<u>, {\anN} position tags.
   SCC: decodes the CEA-608 caption data (channel CC1, or CC2 if CC1 is empty):
        pop-on, paint-on and roll-up captions, row/column placement, italics,
        and the full 608 character set (including ¿ ¡ ñ é …). Each caption keeps
        its placement as qc:halign / qc:valign for the placement checks.
   ========================================================================== */
const Sidecar = (() => {
  const p2 = n => String(n).padStart(2, '0');
  const clock = s => { const ms = Math.round(Math.max(0, s) * 1000); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`; };
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NS = 'xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:qc="urn:subtitle-qc"';

  // ---------------------------------------------------------------- SRT
  const isSrt = (text, name) => /\.srt$/i.test(name || '') || /^\uFEFF?\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text || '');
  function srtTime(t) {
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : null;
  }
  const SRT_STYLE = { i: 'tts:fontStyle="italic"', b: 'tts:fontWeight="bold"', u: 'tts:textDecoration="underline"' };
  function srtInline(text) {
    let out = '';
    const open = [];
    for (const part of text.split(/(<[^>]*>|\{[^}]*\})/)) {
      if (!part) continue;
      if (part[0] === '{' && part.endsWith('}')) continue;           // {\an8} etc. handled separately
      const tag = part.match(/^<(\/?)([a-z]+)[^>]*>$/i);
      if (tag) {
        const n = tag[2].toLowerCase();
        if (!SRT_STYLE[n]) continue;                                   // <font …> and others: keep the text only
        if (!tag[1]) { out += `<span ${SRT_STYLE[n]}>`; open.push(n); }
        else { const i = open.lastIndexOf(n); if (i >= 0) { out += '</span>'.repeat(open.length - i); open.length = i; } }
        continue;
      }
      out += xml(part.replace(/&nbsp;/g, '\u00a0')).replace(/\n/g, '<br/>');
    }
    return out + '</span>'.repeat(open.length);
  }
  function srtToTTML(text) {
    const blocks = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
    const ps = [];
    for (const block of blocks) {
      const lines = block.split('\n').filter((l, k) => !(k === 0 && !l.trim()));
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti < 0 || ti > 1) continue;
      const tm = lines[ti].match(/^\s*(\S+)\s*-->\s*(\S+)/);
      if (!tm) continue;
      const b = srtTime(tm[1]), e = srtTime(tm[2]);
      if (b == null || e == null) continue;
      const body = lines.slice(ti + 1).join('\n').replace(/\s+$/, '');
      if (!body.trim()) continue;
      const an = (body.match(/\{\\an([1-9])\}/) || [])[1];
      const n = an ? +an : 2;
      const valign = n >= 7 ? 'top' : n >= 4 ? 'raised' : 'bottom';
      const halign = n % 3 === 1 ? 'left' : n % 3 === 0 ? 'right' : 'center';
      const region = valign === 'top' ? 'top' : valign === 'raised' ? 'middle' : 'bottom';
      ps.push(`    <p begin="${clock(b)}" end="${clock(e)}" region="${region}"${halign !== 'center' ? ` tts:textAlign="${halign}"` : ''} qc:halign="${halign}" qc:valign="${valign}">${srtInline(body)}</p>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt ${NS} ttp:timeBase="media">
  <head>
    <styling><style xml:id="s" tts:color="white" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:textAlign="center"/></styling>
    <layout>
      <region xml:id="bottom" tts:origin="0% 0%" tts:extent="100% 100%" tts:displayAlign="after" tts:textAlign="center"/>
      <region xml:id="middle" tts:origin="0% 0%" tts:extent="100% 100%" tts:displayAlign="center" tts:textAlign="center"/>
      <region xml:id="top" tts:origin="0% 0%" tts:extent="100% 100%" tts:displayAlign="before" tts:textAlign="center"/>
    </layout>
  </head>
  <body style="s"><div>
${ps.join('\n')}
  </div></body>
</tt>
`;
  }

  // ---------------------------------------------------------------- SCC (CEA-608)
  const isScc = (text, name) => /^\uFEFF?\s*Scenarist_SCC/i.test(text || '') || (/\.scc$/i.test(name || '') && /\d\d:\d\d:\d\d[:;]\d\d\s+[0-9a-f]{4}/i.test(text || ''));

  // Standard characters that differ from ASCII, then special (0x11 0x30-3F) and extended sets.
  const BASIC = { 0x2a: 'á', 0x5c: 'é', 0x5e: 'í', 0x5f: 'ó', 0x60: 'ú', 0x7b: 'ç', 0x7c: '÷', 0x7d: 'Ñ', 0x7e: 'ñ', 0x7f: '█' };
  const SPECIAL = '®°½¿™¢£♪à\u00a0èâêîôû';
  const EXT_12 = 'ÁÉÓÚÜü‘¡*’—©℠•“”ÀÂÇÈÊËëÎÏïÔÙùÛ«»';
  const EXT_13 = 'ÃãÍÌìÒòÕõ{}\\^_|~ÄäÖöß¥¤│ÅåØø┌┐└┘';
  // PAC row from the first byte (channel bit removed) and whether the second byte is >= 0x60.
  const PAC_ROWS = { 0x11: [1, 2], 0x12: [3, 4], 0x15: [5, 6], 0x16: [7, 8], 0x17: [9, 10], 0x10: [11, 11], 0x13: [12, 13], 0x14: [14, 15] };

  function sccFrames(tc, nominal, drop) {
    const m = tc.match(/^(\d\d):(\d\d):(\d\d)[:;.](\d\d)$/);
    if (!m) return null;
    const [h, mi, s, f] = [m[1], m[2], m[3], m[4]].map(Number);
    let n = (h * 3600 + mi * 60 + s) * nominal + f;
    if (drop) { const tm = h * 60 + mi; n -= 2 * (tm - Math.floor(tm / 10)); }
    return n;
  }
  function decodeScc(text, channel) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const timed = [];
    let drop = false, maxF = 0;
    for (const l of lines) {
      const m = l.match(/^(\d\d:\d\d:\d\d[:;.]\d\d)\s+(.+)$/);
      if (!m) continue;
      if (/;|\./.test(m[1].slice(8, 9))) drop = true;
      maxF = Math.max(maxF, +m[1].slice(9, 11));
      timed.push([m[1], m[2].trim().split(/\s+/).filter(w => /^[0-9a-f]{4}$/i.test(w))]);
    }
    // SCC timecodes are normally 29.97 (drop-frame when written with ';'). Some files are labelled
    // against the video's own timecode instead: frame numbers that never pass 23 are read at 23.976,
    // and a long file whose frames stop at exactly 24 is read at 25.
    const nominal = drop || maxF > 24 ? 30 : maxF === 24 ? (timed.length > 20 ? 25 : 30) : 24;
    const toLabelFrames = (k) => nominal === 30 ? k : Math.round(k * nominal / 30);   // each byte pair takes 1/29.97 s

    const blank = () => new Map();                    // row -> { cells: [{ch, it}], }
    let mem = { disp: blank(), non: blank() }, mode = 'pop', row = 15, col = 0, italic = false, rollRows = 2;
    let lastCtrl = null;
    const captions = [];
    let open = null;                                   // { start, content }

    const rowOf = (m, r) => { if (!m.has(r)) m.set(r, []); return m.get(r); };
    const target = () => mode === 'pop' ? mem.non : mem.disp;
    const put = (ch) => {
      const cells = rowOf(target(), row);
      while (cells.length < col) cells.push(null);
      cells[col] = { ch, it: italic };
      col = Math.min(31, col + 1);
      if (mode !== 'pop') changed = true;
    };
    let changed = false;
    const snapshot = (m) => {
      const rows = [...m.entries()].filter(([, c]) => c.some(x => x && x.ch.trim())).sort((a, b) => a[0] - b[0]);
      if (!rows.length) return null;
      return rows.map(([r, cells]) => {
        let first = cells.findIndex(x => x && x.ch.trim()), last = cells.length - 1;
        while (last > first && !(cells[last] && cells[last].ch.trim())) last--;
        return { row: r, col: first, cells: cells.slice(first, last + 1).map(x => x || { ch: ' ', it: false }) };
      });
    };
    const keyOf = (snap) => snap ? JSON.stringify(snap.map(l => [l.row, l.col, l.cells.map(c => c.ch + (c.it ? '/' : '')).join('')])) : '';
    const show = (t) => {                              // the displayed memory changed at label frame t
      const snap = snapshot(mem.disp), key = keyOf(snap);
      if (open && open.key === key) return;
      if (open) { open.end = t; if (open.end > open.start) captions.push(open); }
      open = snap ? { start: t, snap, key } : null;
    };

    for (const [tc, words] of timed) {
      const base = sccFrames(tc, nominal, drop);
      if (base == null) continue;
      words.forEach((w, k) => {
        const t = base + toLabelFrames(k);
        let b1 = parseInt(w.slice(0, 2), 16) & 0x7f, b2 = parseInt(w.slice(2, 4), 16) & 0x7f;
        if (b1 === 0 && b2 === 0) { lastCtrl = null; return; }
        if (b1 >= 0x10 && b1 <= 0x1f) {
          // control code: channel 2 uses 0x18-0x1F. Doubled control codes are sent twice: act once.
          const ch = b1 >= 0x18 ? 2 : 1;
          if (w === lastCtrl) { lastCtrl = null; return; }
          lastCtrl = w;
          if (ch !== channel) return;
          const c1 = b1 & 0xf7;                        // channel bit off
          if ((c1 === 0x14 || c1 === 0x15) && b2 >= 0x20 && b2 <= 0x2f) {
            switch (b2) {
              case 0x20: mode = 'pop'; break;                                         // RCL
              case 0x21: { const cells = rowOf(target(), row); if (col > 0) { col--; cells[col] = null; } if (mode !== 'pop') changed = true; break; } // BS
              case 0x24: { const cells = rowOf(target(), row); cells.length = Math.min(cells.length, col); if (mode !== 'pop') changed = true; break; } // DER
              case 0x25: case 0x26: case 0x27: mode = 'roll'; rollRows = b2 - 0x23; row = 15; break;   // RU2-4
              case 0x29: mode = 'paint'; break;                                       // RDC
              case 0x2c: mem.disp = blank(); show(t); break;                          // EDM
              case 0x2d:                                                              // CR (roll-up)
                if (mode === 'roll') {
                  const m = new Map();
                  for (const [r, c] of mem.disp) if (r - 1 > 15 - rollRows) m.set(r - 1, c);
                  mem.disp = m; col = 0; changed = true;
                }
                break;
              case 0x2e: mem.non = blank(); break;                                    // ENM
              case 0x2f: { const d = mem.disp; mem.disp = mem.non; mem.non = d; show(t); break; } // EOC
            }
            return;
          }
          if (c1 === 0x17 && b2 >= 0x21 && b2 <= 0x23) { col = Math.min(31, col + (b2 - 0x20)); return; }   // tab offset
          if (c1 === 0x11 && b2 >= 0x20 && b2 <= 0x2f) { italic = b2 >= 0x2e; put(' '); return; }         // mid-row: colour / italics (takes a space)
          if (c1 === 0x11 && b2 >= 0x30 && b2 <= 0x3f) { put(SPECIAL[b2 - 0x30]); return; }                // special characters
          if ((c1 === 0x12 || c1 === 0x13) && b2 >= 0x20 && b2 <= 0x3f) {                                    // extended: replaces the previous character
            const cells = rowOf(target(), row);
            if (col > 0) col--;
            cells[col] = null;
            put((c1 === 0x12 ? EXT_12 : EXT_13)[b2 - 0x20]);
            return;
          }
          if (b2 >= 0x40 && b2 <= 0x7f && PAC_ROWS[c1]) {                                                    // PAC: row, indent, italics
            const r = PAC_ROWS[c1][b2 >= 0x60 ? 1 : 0];
            if (mode === 'roll') { /* roll-up writes on the base row */ } else row = r;
            const a = b2 & 0x1f;
            italic = a === 0x0e || a === 0x0f;
            col = a >= 0x10 ? ((a & 0x0e) >> 1) * 4 : 0;
            if (mode === 'roll') col = 0;
            return;
          }
          return;
        }
        lastCtrl = null;
        // printable pair (other channels' text was blanked by decodeWithChannels)
        for (const b of [b1, b2]) if (b >= 0x20) put(BASIC[b] || String.fromCharCode(b));
        if (mode !== 'pop') changed = true;
      });
      if (changed) { changed = false; show(base + toLabelFrames(words.length)); }
    }
    if (open) { open.end = open.start + nominal * 3; captions.push(open); }
    return { captions, nominal, drop };
  }

  function placement(snap) {
    const top = snap[0].row, bottom = snap[snap.length - 1].row;
    const valign = bottom >= 14 ? 'bottom' : top <= 4 ? 'top' : 'raised';
    const centres = snap.map(l => l.col + l.cells.length / 2);
    const lefts = snap.map(l => l.col), rights = snap.map(l => l.col + l.cells.length);
    let halign = 'center';
    const avg = centres.reduce((a, b) => a + b, 0) / centres.length;
    if (Math.abs(avg - 16) > 4) halign = avg < 16 ? 'left' : 'right';
    if (snap.length > 1 && Math.max(...lefts) - Math.min(...lefts) <= 0 && Math.min(...lefts) <= 6) halign = 'left';
    if (snap.length > 1 && Math.max(...rights) - Math.min(...rights) <= 0 && Math.min(...rights) >= 26) halign = 'right';
    return { valign, halign };
  }

  function sccToTTML(text) {
    let res = decodeWithChannels(text, 1);
    if (!res.captions.length) res = decodeWithChannels(text, 2);
    const { captions, nominal, drop } = res;
    // Frame counts become clock times (drop-frame labels were already counted as real frames).
    // The rate is still declared so the player can show it.
    const rate = nominal === 25 ? 25 : nominal * 1000 / 1001;
    const regions = new Map(), names = new Map(), count = {};   // region ids read as bottom, bottom-2, top, raised …
    const ps = captions.map(c => {
      const { valign, halign } = placement(c.snap);
      const lines = c.snap.map(l => {
        let out = '\u00a0'.repeat(l.col), it = false;          // column position kept as monospace indent
        for (const cell of l.cells) {
          if (cell.it !== it) { out += cell.it ? '<span tts:fontStyle="italic">' : '</span>'; it = cell.it; }
          out += xml(cell.ch);
        }
        return out + (it ? '</span>' : '');
      });
      // 608 grid: 32 columns over the middle 80% of the width, 15 rows over the middle 80% of the height.
      // Bottom captions hang from their last row, others from their first, so most share one region.
      const rowH = 80 / 15, anchor = valign === 'bottom' ? c.snap[c.snap.length - 1].row : c.snap[0].row;
      const key = valign + anchor;
      if (!names.has(key)) { const n = (count[valign] = (count[valign] || 0) + 1); names.set(key, n === 1 ? valign : `${valign}-${n}`); }
      const rid = names.get(key);
      if (!regions.has(rid)) regions.set(rid, valign === 'bottom'
        ? `      <region xml:id="${rid}" tts:origin="10% 0%" tts:extent="80% ${(10 + anchor * rowH).toFixed(2)}%" tts:displayAlign="after" tts:textAlign="left"/>`
        : `      <region xml:id="${rid}" tts:origin="10% ${(10 + (anchor - 1) * rowH).toFixed(2)}%" tts:extent="80% ${(90 - (anchor - 1) * rowH).toFixed(2)}%" tts:displayAlign="before" tts:textAlign="left"/>`);
      return `    <p begin="${clock(c.start / rate)}" end="${clock(c.end / rate)}" region="${rid}" qc:halign="${halign}" qc:valign="${valign}">${lines.join('<br/>')}</p>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt ${NS} ttp:timeBase="media" ttp:frameRate="${nominal}" ttp:frameRateMultiplier="${nominal === 25 ? '1 1' : '1000 1001'}">
  <head>
    <styling><style xml:id="s" tts:color="white" tts:backgroundColor="#000000c0" tts:fontFamily="monospaceSansSerif" tts:fontSize="100%" tts:textAlign="left"/></styling>
    <layout>
${[...regions.values()].join('\n')}
    </layout>
  </head>
  <body style="s"><div>
${ps.join('\n')}
  </div></body>
</tt>
`;
  }

  // Channel-aware wrapper: printable pairs go to the channel named by the most recent control code.
  function decodeWithChannels(text, channel) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    // Pre-scan which channel each printable pair belongs to, then hand only the wanted ones to the decoder.
    let cur = 1;
    const out = lines.map(l => {
      const m = l.match(/^(\d\d:\d\d:\d\d[:;.]\d\d)\s+(.+)$/);
      if (!m) return l;
      const words = m[2].trim().split(/\s+/).map(w => {
        if (!/^[0-9a-f]{4}$/i.test(w)) return w;
        const b1 = parseInt(w.slice(0, 2), 16) & 0x7f;
        if (b1 >= 0x10 && b1 <= 0x1f) { cur = b1 >= 0x18 ? 2 : 1; return w; }
        if (b1 === 0 && (parseInt(w.slice(2, 4), 16) & 0x7f) === 0) return w;
        return cur === channel ? w : '8080';                     // other channel's text -> padding
      });
      return m[1] + '\t' + words.join(' ');
    });
    return decodeScc(out.join('\n'), channel);
  }

  // ---------------------------------------------------------------- dispatcher
  // Returns { format, ttml, hasFps } for SRT / SCC / WebVTT, or null for TTML-family files.
  function convert(text, name) {
    if (typeof Vtt !== 'undefined' && Vtt.isVtt(text, name)) return { format: 'WebVTT', ttml: Vtt.toTTML(text), hasFps: false };
    if (isScc(text, name)) return { format: 'SCC', ttml: sccToTTML(text), hasFps: true };
    if (isSrt(text, name)) return { format: 'SRT', ttml: srtToTTML(text), hasFps: false };
    return null;
  }
  return { convert, srtToTTML, sccToTTML, isSrt, isScc };
})();
if (typeof module !== 'undefined') module.exports = Sidecar;
