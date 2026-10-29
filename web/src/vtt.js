/* ==========================================================================
   WebVTT support: a .vtt file is turned into equivalent TTML as it is read, so
   the language checks, cue checks and the player all work on it unchanged.
   Keeps: timing, line breaks, italic / bold / underline, top or bottom
   placement (line:) and alignment (align:), and a "Language:" header if present.
   ========================================================================== */
const Vtt = (() => {
  const isVtt = (text, name) => /^﻿?WEBVTT/.test(text || '') || /\.vtt$/i.test(name || '');

  // [hh:]mm:ss.ttt
  function seconds(t) {
    const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
  }
  const p2 = n => String(n).padStart(2, '0');
  const clock = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = (ms % 60000) / 1000; return `${p2(h)}:${p2(m)}:${x.toFixed(3).padStart(6, '0')}`; };
  const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ENT = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏', quot: '"', apos: "'" };
  const decode = s => s.replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi,
    (all, n, d, h) => n ? ENT[n.toLowerCase()] : String.fromCodePoint(d ? +d : parseInt(h, 16)));
  const STYLE = { i: 'tts:fontStyle="italic"', b: 'tts:fontWeight="bold"', u: 'tts:textDecoration="underline"' };

  // Cue text (with VTT tags) -> TTML inline content
  function inline(text) {
    let out = '';
    const open = [];
    for (const part of text.split(/(<[^>]*>)/)) {
      if (!part) continue;
      const tag = part.match(/^<(\/?)([a-z]+)[^>]*>$/i);
      if (tag) {
        const name = tag[2].toLowerCase();
        if (!STYLE[name]) continue;                       // <c>, <v Speaker>, <lang>, <ruby>, timestamps: keep text only
        if (!tag[1]) { out += `<span ${STYLE[name]}>`; open.push(name); }
        else { const i = open.lastIndexOf(name); if (i >= 0) { out += '</span>'.repeat(open.length - i); open.length = i; } }
        continue;
      }
      if (/^<[\d:.]+>$/.test(part)) continue;               // karaoke timestamp
      out += xml(decode(part)).replace(/\n/g, '<br/>');
    }
    return out + '</span>'.repeat(open.length);
  }

  function toTTML(text) {
    const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    // header: "WEBVTT" plus optional "Key: value" lines until the first blank line
    let i = 0, lang = '';
    if (/^WEBVTT/.test(lines[0] || '')) {
      i = 1;
      for (; i < lines.length && lines[i].trim() !== ''; i++) {
        const m = lines[i].match(/^\s*language\s*:\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)\s*$/i);
        if (m) lang = m[1].replace(/_/g, '-');
      }
    }
    const blocks = lines.slice(i).join('\n').split(/\n[ \t]*\n+/);
    const ps = [];
    for (const block of blocks) {
      const bl = block.split('\n').filter((l, k, a) => !(k === 0 && l.trim() === ''));
      if (!bl.length || /^(NOTE|STYLE|REGION)\b/.test(bl[0])) continue;
      const ti = bl.findIndex(l => l.includes('-->'));
      if (ti < 0 || ti > 1) continue;
      const tm = bl[ti].match(/^\s*(\S+)\s+-->\s+(\S+)\s*(.*)$/);
      if (!tm) continue;
      const b = seconds(tm[1]), e = seconds(tm[2]);
      if (b == null || e == null) continue;
      const settings = {};
      for (const kv of (tm[3] || '').split(/\s+/)) { const [k, v] = kv.split(':'); if (k && v) settings[k.toLowerCase()] = v; }
      let top = false;
      if (settings.line) {
        const v = settings.line.split(',')[0];
        top = /%$/.test(v) ? parseFloat(v) < 50 : (+v >= 0);
      }
      const al = (settings.align || '').toLowerCase();
      const align = al === 'start' || al === 'left' ? 'left' : al === 'end' || al === 'right' ? 'right' : 'center';
      const body = bl.slice(ti + 1).join('\n').replace(/\s+$/, '');
      if (!body.trim()) continue;
      ps.push(`    <p begin="${clock(b)}" end="${clock(e)}" region="${top ? 'top' : 'bottom'}"${align !== 'center' ? ` tts:textAlign="${align}"` : ''}>${inline(body)}</p>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media"${lang ? ` xml:lang="${xml(lang)}"` : ''}>
  <head>
    <styling><style xml:id="vtt" tts:color="white" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:textAlign="center"/></styling>
    <layout>
      <region xml:id="bottom" tts:origin="0% 0%" tts:extent="100% 100%" tts:displayAlign="after" tts:textAlign="center"/>
      <region xml:id="top" tts:origin="0% 0%" tts:extent="100% 100%" tts:displayAlign="before" tts:textAlign="center"/>
    </layout>
  </head>
  <body style="vtt"><div>
${ps.join('\n')}
  </div></body>
</tt>
`;
  }
  return { isVtt, toTTML };
})();
if (typeof module !== 'undefined') module.exports = Vtt;
