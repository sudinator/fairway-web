(function () {
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  function labelFor(el) {
    const id = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const parentText = el.closest('label,div,td,li')?.innerText || '';
    return [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.name, id && id.innerText, parentText].filter(Boolean).join(' ').toLowerCase();
  }
  function setValue(el, val) {
    if (val == null || val === '') return false;
    const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
    if (setter) setter.call(el, String(val)); else el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function clickText(patterns) {
    const els = Array.from(document.querySelectorAll('button,[role="button"],a,label,span,div')).filter(visible);
    const found = els.find(el => patterns.some(p => (el.innerText || '').toLowerCase().includes(p)));
    if (found) { found.click(); return true; }
    return false;
  }
  async function readPayload() {
    let raw = '';
    try { raw = await navigator.clipboard.readText(); } catch (_) {}
    if (!raw || !raw.trim().startsWith('{')) {
      raw = prompt('Paste the BirdieNumNum GHIN Auto-Fill JSON here:') || '';
    }
    return JSON.parse(raw);
  }
  function fillCourseInfo(data) {
    const inputs = Array.from(document.querySelectorAll('input,textarea')).filter(visible);
    const courseInput = inputs.find(el => /course|club|search/.test(labelFor(el)));
    if (courseInput && data.course) setValue(courseInput, data.course);
    const teeInput = inputs.find(el => /tee/.test(labelFor(el)));
    if (teeInput && data.tee) setValue(teeInput, data.tee);
    clickText([String(data.roundType || '').toLowerCase()]);
    if (data.startingHole) {
      const startInput = inputs.find(el => /start|starting/.test(labelFor(el)));
      if (startInput) setValue(startInput, data.startingHole);
    }
  }
  function fillScoreScreen(data) {
    clickText(['advanced stats', 'advanced']);
    const inputs = Array.from(document.querySelectorAll('input')).filter(el => visible(el) && !el.disabled && !el.readOnly);
    const scoreInputs = inputs.filter(el => /score|strokes|gross|hole/.test(labelFor(el)) || ['number','tel','text'].includes(el.type));
    let scoresSet = 0;
    (data.holes || []).forEach((h, i) => {
      const el = scoreInputs[i];
      if (el && setValue(el, h.score)) scoresSet++;
    });

    const puttInputs = inputs.filter(el => /putt/.test(labelFor(el)));
    let puttsSet = 0;
    (data.holes || []).forEach((h, i) => {
      const el = puttInputs[i];
      if (el && h.putts != null && setValue(el, h.putts)) puttsSet++;
    });

    const penaltyInputs = inputs.filter(el => /penalt|pen\b/.test(labelFor(el)));
    let penaltiesSet = 0;
    (data.holes || []).forEach((h, i) => {
      const el = penaltyInputs[i];
      if (el && h.penalties != null && setValue(el, h.penalties)) penaltiesSet++;
    });

    (data.holes || []).forEach((h) => {
      if (h.fairway === 'hit') clickText(['fairway hit', 'hit']);
      if (h.gir === true) clickText(['gir']);
    });
    return { scoresSet, puttsSet, penaltiesSet };
  }
  function showResult(msg) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:999999;right:16px;bottom:16px;max-width:360px;background:#0E3B2E;color:#F7F3E8;padding:14px 16px;border-radius:12px;font:14px system-ui;box-shadow:0 8px 28px rgba(0,0,0,.35)';
    box.innerHTML = '<b>BirdieNumNum GHIN AutoFill</b><br>' + msg + '<br><button style="margin-top:10px;padding:7px 10px;border:0;border-radius:8px;background:#C9A227;color:#0E3B2E;font-weight:700">Close</button>';
    box.querySelector('button').onclick = () => box.remove();
    document.body.appendChild(box);
  }
  (async function main() {
    try {
      const data = await readPayload();
      fillCourseInfo(data);
      const r = fillScoreScreen(data);
      showResult('Attempted to fill the page. Scores filled: ' + r.scoresSet + '. Putts filled: ' + r.puttsSet + '. Penalties filled: ' + r.penaltiesSet + '. Please review every field before posting to GHIN.');
    } catch (e) {
      showResult('Could not read/fill the data: ' + (e && e.message ? e.message : e));
    }
  })();
})();
