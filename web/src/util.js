/* Small helpers shared by all modules. */
// In the Mac app settings are kept by the app itself; in a browser they live in localStorage.
const Store = {
  get(k) { if (typeof NATIVE !== 'undefined' && NATIVE) return Native.Settings.get(k); try { return localStorage.getItem('slc:' + k); } catch (e) { return null; } },
  set(k, v) { if (typeof NATIVE !== 'undefined' && NATIVE) return Native.Settings.set(k, v); try { localStorage.setItem('slc:' + k, v); } catch (e) { /* storage unavailable */ } },
  del(k) { if (typeof NATIVE !== 'undefined' && NATIVE) return Native.Settings.del(k); try { localStorage.removeItem('slc:' + k); } catch (e) {} },
};
// What to call the video player in messages.
const PLAYER_NAME = (typeof NATIVE !== 'undefined' && NATIVE) ? 'This app' : 'Chrome';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
