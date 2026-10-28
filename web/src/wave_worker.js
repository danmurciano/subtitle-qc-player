/* ==========================================================================
   Waveform worker. Reads a .mp4/.mov audio track a chunk at a time, decodes
   it (WebCodecs for AAC/Opus, direct read for PCM) and reduces it to peak
   levels at PEAK_RATE buckets per second. Nothing larger than one chunk of
   audio is held in memory.
   in : { file, sel: 'auto' | number[] (0-based global channel indices) }
   out: { type:'info', duration, channels:[{label}], sel, codec }
        { type:'peaks', start, data:Float32Array }
        { type:'progress', p } | { type:'done' } | { type:'error', message }
   ========================================================================== */
const PEAK_RATE = 100;
const td = new TextDecoder('latin1');
const fourcc = (dv, p) => td.decode(new Uint8Array(dv.buffer, dv.byteOffset + p, 4));

async function readBytes(file, start, len) { return new DataView(await file.slice(start, start + len).arrayBuffer()); }
function boxes(dv, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p), hdr = 8;
    const type = fourcc(dv, p + 4);
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p + hdr, end: p + size });
    p += size;
  }
  return out;
}
const child = (dv, b, t) => b && boxes(dv, b.start, b.end).find(x => x.type === t);
const path = (dv, b, ...ts) => ts.reduce((x, t) => x && child(dv, x, t), b);

async function findMoov(file) {
  let p = 0;
  while (p + 8 <= file.size) {
    const h = await readBytes(file, p, 16);
    let size = h.getUint32(0);
    const type = fourcc(h, 4);
    if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - p;
    if (size < 8) return null;
    if (type === 'moov') return readBytes(file, p, size);
    p += size;
  }
  return null;
}

// ---------------------------------------------------------------- track parsing
function parseTrack(dv, trak) {
  const mdia = child(dv, trak, 'mdia');
  const hdlr = child(dv, mdia, 'hdlr');
  if (!hdlr || fourcc(dv, hdlr.start + 8) !== 'soun') return null;
  const mdhd = child(dv, mdia, 'mdhd');
  const v = dv.getUint8(mdhd.start);
  const timescale = v === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
  const stbl = path(dv, mdia, 'minf', 'stbl');
  const stsd = child(dv, stbl, 'stsd');
  const e = stsd.start + 8;                          // first sample entry
  const eEnd = e + dv.getUint32(e);
  const fmt = fourcc(dv, e + 4);
  const sv = dv.getUint16(e + 16);                   // sound description version
  let channels = dv.getUint16(e + 24), bits = dv.getUint16(e + 26);
  let rate = dv.getUint32(e + 32) / 65536;
  let childStart = e + 36, bytesPerFrame = 0, flags = 0;
  if (sv === 1) { bytesPerFrame = dv.getUint32(e + 44); childStart = e + 52; }
  else if (sv === 2) {
    rate = dv.getFloat64(e + 40); channels = dv.getUint32(e + 48);
    bits = dv.getUint32(e + 56); flags = dv.getUint32(e + 60); bytesPerFrame = dv.getUint32(e + 64); childStart = e + 72;
  }
  const kids = boxes(dv, childStart, eEnd);
  const findDeep = (list, t) => { for (const k of list) { if (k.type === t) return k; if (k.type === 'wave') { const r = findDeep(boxes(dv, k.start, k.end), t); if (r) return r; } } return null; };
  const t = { fmt, channels, bits, rate, flags, timescale, bytesPerFrame };
  // PCM endianness/float
  const enda = findDeep(kids, 'enda');
  if (fmt === 'sowt') t.little = true; else if (fmt === 'twos') t.little = false;
  else if (fmt === 'lpcm') { t.little = !(flags & 2); t.float = !!(flags & 1); }
  else if (['in24', 'in32', 'fl32', 'fl64'].includes(fmt)) { t.little = enda ? dv.getUint16(enda.start) === 1 : false; t.float = fmt.startsWith('fl'); t.bits = fmt === 'in24' ? 24 : fmt === 'in32' || fmt === 'fl32' ? 32 : 64; }
  else if (fmt === 'raw ') { t.bits = 8; t.unsigned = true; }
  if (fmt === 'ipcm' || fmt === 'fpcm') { const pc = findDeep(kids, 'pcmC'); if (pc) { const f = dv.getUint8(pc.start + 4); t.little = !!(f & 1); t.bits = dv.getUint8(pc.start + 5); t.float = fmt === 'fpcm'; } }
  t.pcm = ['sowt', 'twos', 'lpcm', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'ipcm', 'fpcm'].includes(fmt);
  if (t.pcm && !t.bytesPerFrame) t.bytesPerFrame = channels * (t.bits / 8);
  // codec config
  if (fmt === 'mp4a') {
    const esds = findDeep(kids, 'esds');
    t.asc = esds ? parseEsds(dv, esds) : null;
    if (t.asc) {
      const aot = t.asc[0] >> 3;
      t.codec = 'mp4a.40.' + (aot === 31 ? 32 + (((t.asc[0] & 7) << 3) | (t.asc[1] >> 5)) : aot);
      const cc = (t.asc[1] >> 3) & 15;
      if (cc) t.channels = cc === 7 ? 8 : cc;
    } else t.codec = 'mp4a.40.2';
  } else if (fmt === 'Opus') {
    t.codec = 'opus';
    const dops = findDeep(kids, 'dOps');
    if (dops) t.channels = dv.getUint8(dops.start + 1);
  }
  // sample tables
  const stsz = child(dv, stbl, 'stsz'), stsc = child(dv, stbl, 'stsc');
  const stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64'), stts = child(dv, stbl, 'stts');
  if (!stsz || !stsc || !(stco || co64)) return { ...t, empty: true };
  const fixed = dv.getUint32(stsz.start + 4), n = dv.getUint32(stsz.start + 8);
  t.sampleCount = n;
  t.size = i => fixed || dv.getUint32(stsz.start + 12 + 4 * i);
  const nChunks = dv.getUint32((stco || co64).start + 4);
  t.chunkOffset = i => stco ? dv.getUint32(stco.start + 8 + 4 * i) : Number(dv.getBigUint64(co64.start + 8 + 8 * i));
  t.nChunks = nChunks;
  const scN = dv.getUint32(stsc.start + 4);
  t.stsc = [];
  for (let i = 0; i < scN; i++) t.stsc.push([dv.getUint32(stsc.start + 8 + 12 * i) - 1, dv.getUint32(stsc.start + 12 + 12 * i)]);
  t.stts = [];
  if (stts) { const k = dv.getUint32(stts.start + 4); for (let i = 0; i < k; i++) t.stts.push([dv.getUint32(stts.start + 8 + 8 * i), dv.getUint32(stts.start + 12 + 8 * i)]); }
  // edit list: media time where playback starts
  const elst = path(dv, trak, 'edts', 'elst');
  t.mediaStart = 0;
  if (elst) {
    const ev = dv.getUint8(elst.start), cnt = dv.getUint32(elst.start + 4);
    for (let i = 0; i < cnt; i++) {
      const mt = ev === 1 ? Number(dv.getBigInt64(elst.start + 8 + 20 * i + 8)) : dv.getInt32(elst.start + 8 + 12 * i + 4);
      if (mt >= 0) { t.mediaStart = mt / timescale; break; }
    }
  }
  return t;
}

function parseEsds(dv, esds) {
  let p = esds.start + 4;
  const end = esds.end;
  const readLen = () => { let len = 0; for (let i = 0; i < 4; i++) { const b = dv.getUint8(p++); len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return len; };
  while (p < end) {
    const tag = dv.getUint8(p++); const len = readLen();
    if (tag === 0x03) { p += 2; const f = dv.getUint8(p++); if (f & 0x80) p += 2; if (f & 0x40) p += 1 + dv.getUint8(p); if (f & 0x20) p += 2; continue; }
    if (tag === 0x04) { p += 13; continue; }
    if (tag === 0x05) return new Uint8Array(dv.buffer.slice(dv.byteOffset + p, dv.byteOffset + p + len));
    p += len;
  }
  return null;
}

// Iterate chunks: yields { offset, firstSample, count }
function* chunks(t) {
  let s = 0;
  for (let c = 0; c < t.nChunks; c++) {
    let per = 0;
    for (let k = t.stsc.length - 1; k >= 0; k--) if (c >= t.stsc[k][0]) { per = t.stsc[k][1]; break; }
    yield { offset: t.chunkOffset(c), firstSample: s, count: per };
    s += per;
  }
}

// Reads through the file in large windows: one read serves many small audio chunks.
const WINDOW = 8 * 1024 * 1024;
function makeReader(file) {
  let wStart = 0, wEnd = 0, buf = null;
  return async (off, len) => {
    if (!buf || off < wStart || off + len > wEnd) {
      wStart = off; wEnd = Math.min(file.size, off + Math.max(len, WINDOW));
      buf = new Uint8Array(await file.slice(wStart, wEnd).arrayBuffer());
    }
    return buf.subarray(off - wStart, off - wStart + len);
  };
}
let lastProgress = 0;
function throttled(fn) { return d => { const n = Date.now(); if (n - lastProgress > 250) { lastProgress = n; fn(d); } }; }

// ---------------------------------------------------------------- peaks
// Per 10 ms bucket: peak (max |x|) and RMS (from sum of squares).
let peaks, sumsq, counts, pending = { start: Infinity, end: -1 }, lastPost = 0;
function addSample(time, x) {
  const i = Math.floor(time * PEAK_RATE);
  if (i < 0 || i >= peaks.length) return;
  const a = x < 0 ? -x : x;
  if (a > peaks[i]) peaks[i] = a;
  sumsq[i] += x * x; counts[i]++;
  if (i < pending.start) pending.start = i;
  if (i > pending.end) pending.end = i;
}
function flush(force) {
  const now = Date.now();
  if (!force && now - lastPost < 400) return;
  lastPost = now;
  if (pending.end >= pending.start) {
    const a = pending.start, b = pending.end + 1, rms = new Float32Array(b - a);
    for (let i = a; i < b; i++) rms[i - a] = counts[i] ? Math.sqrt(sumsq[i] / counts[i]) : 0;
    postMessage({ type: 'peaks', start: a, data: peaks.slice(a, b), rms });
    pending = { start: Infinity, end: -1 };
  }
}

// ---------------------------------------------------------------- PCM tracks
async function pcmTrack(file, t, chans, progress) {
  const bpf = t.bytesPerFrame, bps = t.bits / 8;
  const read = (dv, o) => {
    if (t.float) return t.bits === 64 ? dv.getFloat64(o, t.little) : dv.getFloat32(o, t.little);
    if (t.bits === 16) return dv.getInt16(o, t.little) / 32768;
    if (t.bits === 24) { const b0 = dv.getUint8(o), b1 = dv.getUint8(o + 1), b2 = dv.getUint8(o + 2); let x = t.little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2; if (x & 0x800000) x -= 0x1000000; return x / 8388608; }
    if (t.bits === 32) return dv.getInt32(o, t.little) / 2147483648;
    if (t.bits === 8) return t.unsigned ? (dv.getUint8(o) - 128) / 128 : dv.getInt8(o) / 128;
    return 0;
  };
  let frame = 0, done = 0;
  const reader = makeReader(file);
  for (const ch of chunks(t)) {
    const len = ch.count * bpf;
    if (ch.offset + len > file.size) break;
    const u8 = await reader(ch.offset, len);
    const dv = new DataView(u8.buffer, u8.byteOffset, len);
    for (let f = 0; f < ch.count; f++) {
      let s = 0;
      for (const c of chans) s += read(dv, f * bpf + c * bps);
      addSample((frame + f) / t.rate - t.mediaStart, s);
    }
    frame += ch.count;
    done += len;
    progress(done); flush();
  }
}

// ---------------------------------------------------------------- compressed tracks (AAC / Opus)
async function codedTrack(file, t, chans, progress) {
  const config = { codec: t.codec, sampleRate: Math.round(t.rate), numberOfChannels: t.channels };
  if (t.asc) config.description = t.asc;
  const sup = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error(`This browser can't decode the audio (${t.codec}).`);
  let err = null;
  const decoder = new AudioDecoder({
    output: (ad) => {
      try {
        const n = ad.numberOfFrames, rate = ad.sampleRate, t0 = ad.timestamp / 1e6 - t.mediaStart;
        const sum = new Float32Array(n), buf = new Float32Array(n);
        for (const c of chans) {
          if (c >= ad.numberOfChannels) continue;
          ad.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < n; i++) sum[i] += buf[i];
        }
        for (let i = 0; i < n; i++) addSample(t0 + i / rate, sum[i]);
      } finally { ad.close(); }
    },
    error: (e) => { err = e; },
  });
  decoder.configure(config);
  // sample timestamps from stts
  const reader = makeReader(file);
  let sttsIdx = 0, sttsLeft = t.stts.length ? t.stts[0][0] : 0, ts = 0, done = 0;
  const nextDelta = () => {
    while (sttsLeft === 0 && sttsIdx < t.stts.length - 1) { sttsIdx++; sttsLeft = t.stts[sttsIdx][0]; }
    sttsLeft--; return t.stts.length ? t.stts[sttsIdx][1] : 1024;
  };
  for (const ch of chunks(t)) {
    if (err) throw err;
    let len = 0;
    for (let i = 0; i < ch.count; i++) len += t.size(ch.firstSample + i);
    if (ch.offset + len > file.size) break;
    const bytes = await reader(ch.offset, len);
    let p = 0;
    for (let i = 0; i < ch.count; i++) {
      const sz = t.size(ch.firstSample + i);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(ts / t.timescale * 1e6), data: bytes.slice(p, p + sz) }));
      p += sz; ts += nextDelta();
    }
    done += len;
    // keep the decoder queue short so memory stays flat
    while (decoder.decodeQueueSize > 256) await new Promise(r => { decoder.addEventListener('dequeue', r, { once: true }); setTimeout(r, 50); });
    progress(done); flush();
  }
  await decoder.flush();
  decoder.close();
  if (err) throw err;
}

// ---------------------------------------------------------------- main
onmessage = async (ev) => {
  const { file, prefs } = ev.data;
  try {
    const dv = await findMoov(file);
    if (!dv) throw new Error('No audio index found in this file.');
    const moov = { start: 8, end: dv.byteLength };
    const mvhd = child(dv, moov, 'mvhd');
    const mv = dv.getUint8(mvhd.start);
    const duration = mv === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) / dv.getUint32(mvhd.start + 20) : dv.getUint32(mvhd.start + 16) / dv.getUint32(mvhd.start + 12);
    const tracks = boxes(dv, moov.start, moov.end).filter(b => b.type === 'trak').map(b => parseTrack(dv, b)).filter(Boolean).filter(t => !t.empty && t.sampleCount);
    if (!tracks.length) {
      const frag = boxes(dv, moov.start, moov.end).some(b => b.type === 'mvex');
      throw new Error(frag ? 'This file uses a streaming (fragmented) layout that isn\'t supported yet.' : 'No audio track found.');
    }
    // global channel list across tracks
    const channels = [];
    tracks.forEach((t, ti) => { for (let c = 0; c < t.channels; c++) channels.push({ track: ti, ch: c }); });
    const total = channels.length;
    const sel = prefs && prefs[total];
    let picks = Array.isArray(sel) ? sel.filter(i => i < total) : null;
    if (!picks || !picks.length) picks = total === 1 ? [0] : total === 2 ? [0, 1] : [2];
    postMessage({ type: 'info', duration, total, tracks: tracks.length, sel: picks, codec: tracks.map(t => t.codec || t.fmt).join(', ') });
    peaks = new Float32Array(Math.ceil(duration * PEAK_RATE) + 1);
    sumsq = new Float64Array(peaks.length); counts = new Uint32Array(peaks.length);
    // group picks per track
    const byTrack = new Map();
    for (const g of picks) { const { track, ch } = channels[g]; if (!byTrack.has(track)) byTrack.set(track, []); byTrack.get(track).push(ch); }
    let totalBytes = 0;
    const trackBytes = t => t.pcm ? t.sampleCount * (t.size(0) <= 1 ? t.bytesPerFrame : t.size(0)) : (() => { let b = 0; for (let i = 0; i < t.sampleCount; i++) b += t.size(i); return b; })();
    for (const [ti] of byTrack) totalBytes += trackBytes(tracks[ti]);
    let base = 0;
    const progress = throttled(d => postMessage({ type: 'progress', p: Math.min(1, (base + d) / (totalBytes || 1)) }));
    for (const [ti, chans] of byTrack) {
      const t = tracks[ti];
      if (t.pcm) await pcmTrack(file, t, chans, progress);
      else if (t.codec) await codedTrack(file, t, chans, progress);
      else throw new Error(`Audio format “${t.fmt}” isn't supported.`);
      flush(true);
      base += trackBytes(t);
    }
    flush(true);
    postMessage({ type: 'done' });
  } catch (e) {
    postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
