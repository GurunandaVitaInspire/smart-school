/* Smart School — Telugu text-to-speech (Vercel serverless function).
 *
 * Why: the browser's own voice only speaks Telugu if that phone/computer has a Telugu voice
 * installed (most Windows PCs and iPhones do not). This turns text into real Telugu audio on
 * the server so "Listen" works on every device.
 *
 * Provider: Bhashini — the Government of India's free Indian-language AI service. Same two-step
 * API as the team's Interactive Progress Report project (backend/app/integrations/bhashini.py):
 *   1. pipeline config  → inference URL + short-lived key
 *   2. pipeline compute → base64 WAV audio
 *
 * Setup (once, in Vercel → Project → Settings → Environment Variables):
 *   BHASHINI_USER_ID        from https://dashboard.bhashini.co.in  (My Profile)
 *   BHASHINI_ULCA_API_KEY   from the same page
 * Without them this returns 503 and the page quietly uses the device voice instead.
 *
 * Nothing is stored: text in, audio out.
 */
const CONFIG_URL = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
const PIPELINE_ID = '64392f96daac500b55c543cd';
const MAX_CHARS = 600;           // one sentence group per request; the page splits longer text
const LANGS = new Set(['te', 'hi', 'en']);

let cached = {};                 // per-language pipeline config, reused while the function stays warm

function configured() { return !!(process.env.BHASHINI_USER_ID && process.env.BHASHINI_ULCA_API_KEY); }

async function pipelineConfig(lang, refresh) {
  if (cached[lang] && !refresh) return cached[lang];
  const r = await fetch(CONFIG_URL, {
    method: 'POST',
    headers: { userID: process.env.BHASHINI_USER_ID, ulcaApiKey: process.env.BHASHINI_ULCA_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineTasks: [{ taskType: 'tts', config: { language: { sourceLanguage: lang } } }], pipelineRequestConfig: { pipelineId: PIPELINE_ID } }),
  });
  if (!r.ok) throw new Error('Bhashini config ' + r.status);
  const data = await r.json();
  const tts = (data.pipelineResponseConfig || []).find((c) => c.taskType === 'tts');
  const ep = data.pipelineInferenceAPIEndPoint || {};
  const key = ep.inferenceApiKey || {};
  if (!tts || !tts.config || !tts.config[0] || !ep.callbackUrl || !key.name || !key.value) throw new Error('Bhashini config incomplete');
  cached[lang] = { url: ep.callbackUrl, keyName: key.name, keyValue: key.value, serviceId: tts.config[0].serviceId };
  return cached[lang];
}

async function synthesize(text, lang, gender) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const cfg = await pipelineConfig(lang, attempt === 2);
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { [cfg.keyName]: cfg.keyValue, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineTasks: [{ taskType: 'tts', config: { language: { sourceLanguage: lang }, serviceId: cfg.serviceId, gender } }],
        inputData: { input: [{ source: text }], audio: [{ audioContent: null }] },
      }),
    });
    if ((r.status === 401 || r.status === 403) && attempt === 1) continue; // inference key expired: refresh once
    if (!r.ok) throw new Error('Bhashini compute ' + r.status);
    const data = await r.json();
    const b64 = (((data.pipelineResponse || [])[0] || {}).audio || [])[0]?.audioContent;
    if (!b64) throw new Error('Bhashini returned no audio');
    return Buffer.from(b64, 'base64');
  }
  throw new Error('Bhashini auth failed');
}

/* Bhashini sends 32-bit float WAV (about 4 MB a page). Re-pack as 16-bit PCM WAV: half the size, plays everywhere. */
function to16bit(wav) {
  try {
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return wav;
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= wav.length) {
      const id = wav.toString('ascii', pos, pos + 4), size = wav.readUInt32LE(pos + 4), body = pos + 8;
      if (id === 'fmt ') fmt = { tag: wav.readUInt16LE(body), ch: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
      else if (id === 'data') data = wav.subarray(body, Math.min(wav.length, body + size));
      pos = body + size + (size % 2);
    }
    if (!fmt || !data || fmt.tag !== 3 || fmt.bits !== 32) return wav;
    const n = Math.floor(data.length / 4), out = Buffer.alloc(44 + n * 2);
    out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8);
    out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(fmt.ch, 22);
    out.writeUInt32LE(fmt.rate, 24); out.writeUInt32LE(fmt.rate * fmt.ch * 2, 28); out.writeUInt16LE(fmt.ch * 2, 32); out.writeUInt16LE(16, 34);
    out.write('data', 36); out.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data.readFloatLE(i * 4) * 32767))), 44 + i * 2);
    return out;
  } catch (e) { return wav; }
}

function sameSite(req) {
  /* only our own pages may use the free quota */
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const from = req.headers.origin || req.headers.referer || '';
  if (!from) return true; // some browsers omit both on same-origin requests
  try { return new URL(from).host === host; } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') { res.status(200).json({ configured: configured(), provider: 'bhashini' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!sameSite(req)) { res.status(403).json({ error: 'origin' }); return; }
  if (!configured()) { res.status(503).json({ error: 'not-configured' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const text = String((body && body.text) || '').trim();
  const lang = LANGS.has(body && body.lang) ? body.lang : 'te';
  const gender = body && body.gender === 'male' ? 'male' : 'female';
  if (!text) { res.status(400).json({ error: 'empty' }); return; }
  if (text.length > MAX_CHARS) { res.status(413).json({ error: 'too-long', max: MAX_CHARS }); return; }
  try {
    const audio = to16bit(await synthesize(text, lang, gender));
    res.setHeader('Content-Type', 'audio/wav');
    res.status(200).send(audio);
  } catch (e) {
    res.status(502).json({ error: 'tts-failed', detail: String(e.message || e).slice(0, 200) });
  }
};
