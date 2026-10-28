/* ==========================================================================
   Reads the start timecode from a QuickTime/MP4 timecode ('tmcd') track,
   if the file has one. Only the 'moov' box and 4 bytes of sample data are
   read, so this is fast even for large files.
   ========================================================================== */
const TimecodeTrack = (() => {
  const td = new TextDecoder('latin1');

  async function readBytes(file, start, len) {
    return new DataView(await file.slice(start, start + len).arrayBuffer());
  }
  function boxes(dv, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = td.decode(new Uint8Array(dv.buffer, dv.byteOffset + p + 4, 4));
      let hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type, start: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }
  const child = (dv, box, type) => boxes(dv, box.start, box.end).find(b => b.type === type);
  const path = (dv, box, ...types) => types.reduce((b, t) => b && child(dv, b, t), box);

  async function findMoov(file) {
    let p = 0;
    while (p + 8 <= file.size) {
      const h = await readBytes(file, p, 16);
      let size = h.getUint32(0);
      const type = td.decode(new Uint8Array(h.buffer, 4, 4));
      if (size === 1) size = Number(h.getBigUint64(8));
      else if (size === 0) size = file.size - p;
      if (size < 8) return null;
      if (type === 'moov') {
        if (size > 200 * 1024 * 1024) return null;
        return readBytes(file, p, size);
      }
      p += size;
    }
    return null;
  }

  function framesToTC(n, fps, dropFrame) {
    if (dropFrame && (fps === 30 || fps === 60)) {
      const d = fps === 30 ? 2 : 4;
      const per10 = fps * 600 - d * 9;          // frames per 10 minutes
      const per1 = fps * 60 - d;                // frames per (dropped) minute
      const tens = Math.floor(n / per10), rem = n % per10;
      n += d * 9 * tens + (rem > d ? d * Math.floor((rem - d) / per1) : 0);
    }
    const f = n % fps, s = Math.floor(n / fps) % 60, m = Math.floor(n / (fps * 60)) % 60, h = Math.floor(n / (fps * 3600));
    const p = x => String(x).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
  }

  async function read(file) {
    const dv = await findMoov(file);
    if (!dv) return null;
    const moov = { start: 8, end: dv.byteLength };
    for (const trak of boxes(dv, moov.start, moov.end).filter(b => b.type === 'trak')) {
      const hdlr = path(dv, trak, 'mdia', 'hdlr');
      if (!hdlr || td.decode(new Uint8Array(dv.buffer, dv.byteOffset + hdlr.start + 8, 4)) !== 'tmcd') continue;
      const stbl = path(dv, trak, 'mdia', 'minf', 'stbl');
      if (!stbl) continue;
      const stsd = child(dv, stbl, 'stsd');
      if (!stsd) continue;
      // stsd: version/flags(4) count(4) | entry: size(4) 'tmcd'(4) reserved(6) dref(2) reserved(4) flags(4) timescale(4) frameDuration(4) nFrames(1)
      const e = stsd.start + 8;
      if (td.decode(new Uint8Array(dv.buffer, dv.byteOffset + e + 4, 4)) !== 'tmcd') continue;
      const flags = dv.getUint32(e + 20);
      const timescale = dv.getUint32(e + 24);
      const frameDuration = dv.getUint32(e + 28);
      const nFrames = dv.getUint8(e + 32);
      let offset = null;
      const stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
      if (stco && dv.getUint32(stco.start + 4) > 0) offset = dv.getUint32(stco.start + 8);
      else if (co64 && dv.getUint32(co64.start + 4) > 0) offset = Number(dv.getBigUint64(co64.start + 8));
      if (offset == null) continue;
      const sample = await readBytes(file, offset, 4);
      const frameNumber = sample.getUint32(0);
      const dropFrame = !!(flags & 1);
      const fps = nFrames || Math.round(timescale / frameDuration);
      return { tc: framesToTC(frameNumber, fps, dropFrame), fps: +(timescale / frameDuration).toFixed(3), dropFrame, frameNumber };
    }
    return null;
  }
  // Track types and duration, used to skip audio-only files and dubcards.
  async function probe(file) {
    const dv = await findMoov(file);
    if (!dv) return null;
    const moov = { start: 8, end: dv.byteLength };
    const out = { hasVideo: false, hasAudio: false, duration: null };
    const mvhd = child(dv, moov, 'mvhd');
    if (mvhd) {
      const v = dv.getUint8(mvhd.start);
      const ts = v === 1 ? dv.getUint32(mvhd.start + 20) : dv.getUint32(mvhd.start + 12);
      const du = v === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);
      if (ts) out.duration = du / ts;
    }
    for (const trak of boxes(dv, moov.start, moov.end).filter(b => b.type === 'trak')) {
      const hdlr = path(dv, trak, 'mdia', 'hdlr');
      if (!hdlr) continue;
      const t = td.decode(new Uint8Array(dv.buffer, dv.byteOffset + hdlr.start + 8, 4));
      if (t === 'vide') {
        out.hasVideo = true;
        const stsd = path(dv, trak, 'mdia', 'minf', 'stbl', 'stsd');
        if (stsd && !out.codec) {
          out.codec = td.decode(new Uint8Array(dv.buffer, dv.byteOffset + stsd.start + 12, 4));
          const e = stsd.start + 8;   // visual sample entry: width/height at +32/+34
          out.width = dv.getUint16(e + 32); out.height = dv.getUint16(e + 34);
          const mdhd = path(dv, trak, 'mdia', 'mdhd'), stts = path(dv, trak, 'mdia', 'minf', 'stbl', 'stts');
          if (mdhd && stts && dv.getUint32(stts.start + 4) > 0) {
            const mv = dv.getUint8(mdhd.start), ts = mv === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
            const delta = dv.getUint32(stts.start + 12);
            if (ts && delta) out.fps = ts / delta;
          }
        }
      }
      if (t === 'soun') out.hasAudio = true;
    }
    return out;
  }
  const CODECS = {
    avc1: ['H.264', true], avc3: ['H.264', true], hvc1: ['HEVC', true], hev1: ['HEVC', true], dvh1: ['Dolby Vision HEVC', true],
    vp09: ['VP9', true], av01: ['AV1', true], mp4v: ['MPEG-4 Part 2', false],
    apch: ['ProRes 422 HQ', false], apcn: ['ProRes 422', false], apcs: ['ProRes 422 LT', false], apco: ['ProRes 422 Proxy', false],
    ap4h: ['ProRes 4444', false], ap4x: ['ProRes 4444 XQ', false], AVdn: ['DNxHD', false], AVdh: ['DNxHR', false],
    jpeg: ['Motion JPEG', false], mjpa: ['Motion JPEG', false], xdvc: ['XDCAM', false],
  };
  // [name, playable in Chrome]
  function codecInfo(fourcc) {
    if (!fourcc) return null;
    const app = typeof NATIVE !== 'undefined' && NATIVE;
    if (CODECS[fourcc]) {
      const name = CODECS[fourcc][0];
      return { fourcc, name, chrome: app ? !/DNx|XDCAM|MPEG-2|Part 2/.test(name) : CODECS[fourcc][1] };
    }
    if (/^xd5|^xdv|^mx[0-9]|^m2v/.test(fourcc)) return { fourcc, name: 'MPEG-2 / XDCAM', chrome: false };
    return { fourcc, name: fourcc, chrome: null };
  }
  return { read, probe, framesToTC, codecInfo };
})();
