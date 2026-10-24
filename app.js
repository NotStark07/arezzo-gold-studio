(function () {
  'use strict';
  const P = window.ArezzoPricing;
  const F = window.ArezzoFeeds;
  const feedClient = F.createClient();
  const KEY = 'arezzo-gold-studio.v1.';
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
  const wholeMoney = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const grams = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
  const pct = n => (n * 100).toFixed(1) + '%';
  const timeLabel = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short', timeZone: 'America/Chicago' }).format(new Date(date));
  let storageIssue = '';
  function load(key) {
    try { const value = localStorage.getItem(KEY + key); return value ? JSON.parse(value) : null; }
    catch (e) { storageIssue = 'Saved data could not be loaded. Starting settings are in use; this browser may block storage.'; return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(KEY + key, JSON.stringify(value)); return true; }
    catch (e) { storageIssue = 'This browser is not saving settings. Changes work for this session only. Export settings to keep them.'; renderStorage(); return false; }
  }
  let settings = P.clone(P.DEFAULTS);
  const saved = load('settings');
  if (saved) {
    try { settings = P.validateSettings(saved); }
    catch (e) { storageIssue = 'Stored settings did not pass validation. The starting draft is in use. ' + e.message; }
  }
  let quote = null;
  const cached = load('quote');
  if (cached) {
    try { quote = F.restoreQuote(cached, Date.now()); }
    catch (e) { quote = null; }
  }
  const state = { mode: 'store', quoteTrusted: false, fetching: false, lastAttempt: 0, activeProvider: '', attempts: [], error: '', result: null, importPending: false, installPrompt: null };
  const oldInput = load('inputs');
  if (oldInput && ['10', '14', '18'].includes(String(oldInput.karat))) {
    $('weight').value = oldInput.weight || '';
    document.querySelector('input[name="karat"][value="' + oldInput.karat + '"]').checked = true;
    $('premium').value = oldInput.premium === undefined ? settings.rates[oldInput.karat].defaultPremium : oldInput.premium;
  } else { $('premium').value = settings.rates[14].defaultPremium; }
  function selectedKarat() { return Number(document.querySelector('input[name="karat"]:checked').value); }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }
  function renderStorage() {
    $('storage-warning').hidden = !storageIssue;
    $('storage-warning').textContent = storageIssue;
  }
  function freshQuote() {
    return navigator.onLine !== false && state.quoteTrusted && P.quoteState(quote, Date.now(), settings.staleMinutes).fresh;
  }
  function activeSpot() {
    if (state.mode === 'store') return settings.storeSpot;
    if (state.mode === 'manual') return P.num($('manual-spot').value, 'Scenario gold reference', 100, 100000);
    if (!freshQuote()) throw new Error('No verified fresh quote is available. Use Store pricing or enter a What-if reference.');
    return quote.price;
  }
  function renderMarket() {
    const status = P.quoteState(quote, Date.now(), settings.staleMinutes);
    const fresh = freshQuote();
    $('market-price').textContent = quote ? money(quote.price) : '\u2014';
    for (const k of P.KARATS) $('metal-' + k).textContent = quote ? money(P.intrinsic(quote.price, k)) : '\u2014';
    $('market-dot').className = 'status-dot ' + (fresh ? 'fresh' : 'stale');
    if (navigator.onLine === false) $('market-status').textContent = quote ? 'Offline \u00b7 saved quote, not live' : 'Offline \u00b7 no market quote';
    else if (fresh) $('market-status').textContent = state.fetching ? 'Updating provider quote...' : quote.provider === 'xaus' ? 'Latest quote via XAUS backup' : 'Latest provider quote';
    else if (state.fetching) $('market-status').textContent = 'Connecting to ' + (state.activeProvider || 'price provider') + '...';
    else if (quote && !status.fresh) $('market-status').textContent = 'Stale quote \u00b7 live pricing paused';
    else if (quote) $('market-status').textContent = 'Saved quote \u00b7 not verified live';
    else $('market-status').textContent = 'Feed unavailable \u00b7 store mode works';
    $('quote-time').textContent = quote ? quote.source + ' \u00b7 quoted ' + timeLabel(quote.updatedAt) + (fresh ? '' : ' \u00b7 saved values, not live') : 'Gold API / XAUS backup \u00b7 no verified quote received';
    $('quote-time').title = state.error || (quote ? 'Retrieved ' + timeLabel(quote.receivedAt) : 'The feed needs an internet connection.');
    const notice = $('feed-notice');
    let message = '';
    if (!state.fetching && navigator.onLine === false) message = 'You are offline. Store pricing and What-if still work; live pricing is paused.';
    else if (!state.fetching && state.error) message = state.error;
    else if (fresh && quote.provider === 'xaus') message = 'Using the XAUS backup connection because Gold API did not return a usable quote. The source is shown above; store pricing is unchanged.';
    else if (!state.fetching && quote && !status.fresh) message = 'This quote is old or flagged stale by its provider. The market may be closed or the feed may be delayed. It is shown for reference only, not used for Live estimate.';
    notice.hidden = !message; notice.textContent = message;
    const details = ['Arezzo Gold Studio 1.1.1', 'Page: ' + (location.protocol === 'file:' ? 'Local HTML file' : location.protocol === 'about:' ? 'Embedded preview' : location.protocol + ' hosted page'),
      'Browser online signal: ' + String(navigator.onLine), 'Device time: ' + new Date().toISOString(),
      'Live quote verified: ' + String(fresh), 'No weights, premiums, prices, or costs are sent to feed services.'];
    if (state.attempts.length) for (const a of state.attempts) details.push(a.provider + ': ' + a.result + '\n' + a.url + '\nChecked: ' + a.checkedAt + (a.quotedAt ? '\nQuote time: ' + a.quotedAt : ''));
    else details.push(state.fetching ? 'A request is in progress.' : 'No request completed in this session.');
    $('feed-debug').textContent = details.join('\n\n');
    const cooldown = Math.max(0, 30 - Math.floor((Date.now() - state.lastAttempt) / 1000));
    $('refresh-button').disabled = state.fetching || cooldown > 0 || navigator.onLine === false;
    $('refresh-button').textContent = state.fetching ? 'Refreshing...' : cooldown > 0 ? 'Refresh in ' + cooldown + 's' : 'Refresh quote \u21bb';
    const movement = fresh ? quote.price - settings.storeSpot : 0;
    $('band-warning').hidden = !fresh || Math.abs(movement) < settings.reviewMovement;
    if (!$('band-warning').hidden) $('band-warning').textContent = 'Reference review: gold is ' + money(Math.abs(movement)) + '/oz ' + (movement > 0 ? 'above' : 'below') + ' your saved store reference. Calculations in Store pricing have not changed. Review Settings before adopting a new reference.';
    $('policy-chip').textContent = settings.reviewed ? 'Locally reviewed' : 'Draft policy';
    $('policy-chip').title = settings.policyName + (settings.savedAt ? ' \u00b7 saved ' + timeLabel(settings.savedAt) : ' \u00b7 initial calibration, not a current gold quote');
  }
  async function fetchQuote() {
    if (state.fetching || Date.now() - state.lastAttempt < 30000) return;
    if (navigator.onLine === false) { state.error = 'You are offline.'; state.quoteTrusted = false; renderAll(); return; }
    state.fetching = true; state.lastAttempt = Date.now(); state.error = ''; renderMarket();
    try {
      const result = await feedClient.getLatest(settings.staleMinutes, provider => { state.activeProvider = provider.name; renderMarket(); });
      state.attempts = result.attempts;
      if (result.quote) {
        // Never replace a newer saved quote with an older stale response.
        if (result.fresh || !quote || Date.parse(result.quote.updatedAt) >= Date.parse(quote.updatedAt)) quote = result.quote;
        save('quote', quote);
      }
      state.quoteTrusted = result.fresh;
      if (!result.fresh) state.error = 'No fresh gold quote could be verified. Store pricing and What-if still work. If this is a file preview, save the HTML and open it in Edge or Chrome. Open Connection details below to see each feed response.';
    } catch (error) {
      state.quoteTrusted = false;
      state.error = 'Feed error: ' + F.explainError(error) + ' Store pricing and What-if still work.';
    } finally { state.fetching = false; state.activeProvider = ''; renderAll(); }
  }
  function renderMode(spot) {
    for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    $('manual-row').hidden = state.mode !== 'manual';
    $('result-mode').textContent = state.mode === 'store' ? 'STORE' : state.mode === 'live' ? 'LIVE' : 'WHAT-IF';
    if (state.mode === 'store') $('reference-note').textContent = 'Locked at ' + money(settings.storeSpot) + '/oz. Live market moves do not change this price.';
    else if (state.mode === 'live') $('reference-note').textContent = freshQuote() ? 'Using the latest provider quote. This is an estimate, not a store-price update.' : 'Live pricing is paused until a fresh, valid quote is received.';
    else $('reference-note').textContent = 'Test a gold price without changing your saved store policy.';
  }
  function clearResult(message) {
    state.result = null;
    for (const id of ['result-price','effective-price','gold-total','replacement-total','spread-total','spread-margin','cost-per-gram']) $(id).textContent = '\u2014';
    $('result-label').textContent = 'PRICE UNAVAILABLE';
    $('input-error').textContent = message; $('input-error').hidden = false;
    $('copy-button').disabled = true; $('result-warnings').replaceChildren();
    $('historical-row').hidden = true; $('discount-body').replaceChildren();
    $('formula-lines').textContent = 'A valid piece and pricing reference are needed.';
    $('adjustment-note').textContent = '';
    $('result-basis').textContent = 'No price is being recommended. Correct the input or choose another pricing mode.';
  }
  function renderCalculation() {
    renderMode();
    let spot;
    try { spot = activeSpot(); }
    catch (e) { clearResult(e.message); renderRates(null); return; }
    renderRates(spot);
    try {
      const result = P.calculate(settings, { weight: $('weight').value, karat: selectedKarat(), premium: $('premium').value, spot, scope: $('scope').value, historicalCost: $('historical-cost').value });
      state.result = result; $('input-error').hidden = true;
      const excluded = result.warnings.some(w => ['provisional','small','scope','cost','margin'].includes(w.code));
      $('result-label').textContent = excluded ? 'FORMULA ESTIMATE \u00b7 REVIEW NEEDED' : 'PROPOSED CUSTOMER PRICE';
      $('result-price').textContent = Number.isInteger(result.price) ? wholeMoney(result.price) : money(result.price);
      $('effective-price').textContent = money(result.pricePerGram) + '/g';
      $('rounding-label').textContent = money(settings.rounding).replace('.00', '');
      $('result-basis').textContent = result.karat + 'K \u00b7 ' + grams(result.weight) + 'g \u00b7 ' + money(spot) + '/oz ' + (state.mode === 'manual' ? 'scenario' : state.mode === 'store' ? 'locked reference' : 'provider quote') + '. Scan / online price, before tax.';
      $('copy-button').disabled = false;
      $('gold-total').textContent = money(result.goldValue);
      $('cost-per-gram').textContent = money(result.rates.cost) + '/g at ' + grams(result.premium) + '% supplier premium';
      $('replacement-total').textContent = money(result.replacementCost);
      $('spread-total').textContent = money(result.spread);
      $('spread-margin').textContent = pct(result.margin) + ' of selling price';
      $('historical-row').hidden = result.historicalCost === null;
      $('historical-profit').textContent = result.historicalProfit === null ? '\u2014' : money(result.historicalProfit);
      $('result-warnings').replaceChildren();
      for (const warning of result.warnings) {
        const div = document.createElement('div');
        div.className = 'notice ' + (['margin','cost'].includes(warning.code) ? 'danger' : '');
        div.dataset.code = warning.code;
        div.textContent = warning.code === 'draft' ? 'Working draft: review the ' + money(settings.calibrationSpot) + '/oz calibration and saved rates before rollout.' : warning.text;
        $('result-warnings').appendChild(div);
      }
      // All interpolated values below are validated numbers, never user-supplied HTML.
      $('formula-lines').innerHTML = '<div>First ' + grams(result.firstWeight) + 'g &times; ' + money(result.rates.first) + '/g = <strong>' + money(result.firstAmount) + '</strong></div>' + (result.extraWeight > 0 ? '<div>Next ' + grams(result.extraWeight) + 'g &times; ' + money(result.rates.extra) + '/g = <strong>' + money(result.extraAmount) + '</strong></div>' : '<div>No additional grams above ' + grams(settings.breakpoint) + 'g.</div>') + '<div class="formula-total">' + money(result.unrounded) + ' &rarr; ' + money(result.price) + ' after rounding</div>';
      $('adjustment-note').textContent = 'Replacement adjustment: ' + money(result.rates.cost) + '/g now \u2212 ' + money(result.rates.calibrationCost) + '/g at calibration = ' + (result.rates.delta >= 0 ? '+' : '') + money(result.rates.delta) + '/g added to both base rates. Calculations retain full precision until the final rounding.';
      $('discount-body').innerHTML = result.discounts.map(d => '<tr class="' + (d.low ? 'low' : '') + '"><td>' + d.discount + '%<small>' + (d.discount === 0 ? 'Proposed price' : d.discount === 15 ? 'Scenario only' : 'Approval required') + '</small></td><td>' + money(d.price) + '</td><td>' + money(d.spread) + '<small>' + pct(d.margin) + (d.low ? ' \u00b7 review' : '') + '</small></td></tr>').join('');
    } catch (e) { clearResult(e.message); }
  }
  function renderRates(spot) {
    $('rate-reference').textContent = spot === null ? 'Fresh live quote required.' : 'At ' + money(spot) + '/oz\n' + (state.mode === 'store' ? 'Locked store reference' : state.mode === 'live' ? 'Latest provider quote' : 'Manual scenario');
    $('rate-cards').innerHTML = P.KARATS.map(k => {
      const rate = spot === null ? null : P.adjustedRates(settings, k, spot, settings.rates[k].defaultPremium);
      return '<div class="rate-card"><h3>' + k + 'K' + (settings.rates[k].provisional ? '<span>PROVISIONAL</span>' : '') + '</h3><div class="rate-line">First ' + grams(settings.breakpoint) + 'g<strong>' + (rate ? money(rate.first) : '\u2014') + '<small> /g</small></strong></div><div class="rate-line">Additional grams<strong>' + (rate ? money(rate.extra) : '\u2014') + '<small> /g</small></strong></div></div>';
    }).join('');
  }
  function renderAll() { renderStorage(); renderMarket(); renderCalculation(); }
  function rememberInputs() { save('inputs', { weight: $('weight').value, karat: selectedKarat(), premium: $('premium').value }); }
  ['weight','premium','manual-spot','historical-cost','scope'].forEach(id => $(id).addEventListener('input', () => { renderCalculation(); rememberInputs(); }));
  document.querySelectorAll('input[name="karat"]').forEach(el => el.addEventListener('change', () => { $('premium').value = settings.rates[selectedKarat()].defaultPremium; renderCalculation(); rememberInputs(); }));
  document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { state.mode = el.dataset.mode; renderAll(); if (state.mode === 'live') fetchQuote(); }));
  $('reset-premium').addEventListener('click', () => { $('premium').value = settings.rates[selectedKarat()].defaultPremium; renderCalculation(); rememberInputs(); });
  $('refresh-button').addEventListener('click', fetchQuote);
  $('copy-button').addEventListener('click', async () => {
    if (!state.result) return;
    const r = state.result;
    const text = 'Arezzo Jewelers \u2014 ' + (r.warnings.some(w => w.code !== 'draft') ? 'REVIEW ESTIMATE' : settings.reviewed ? 'PROPOSED PRICE' : 'DRAFT ESTIMATE') + '\n' + grams(r.weight) + 'g \u00b7 ' + r.karat + 'K\n' + money(r.price) + ' before tax (' + money(r.pricePerGram) + '/g)\n' + (state.mode === 'store' ? 'Locked store reference' : state.mode === 'live' ? quote.source + ' gold quote' : 'Manual gold scenario') + ': ' + money(r.spot) + '/troy oz\n' + (state.mode === 'live' ? 'Quoted ' + timeLabel(quote.updatedAt) + '\n' : '') + 'No additional discount included. ' + settings.policyName + '.';
    try { await navigator.clipboard.writeText(text); toast('Price copied. Costs and margins were not included.'); }
    catch (e) {
      const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.left = '-9999px'; document.body.appendChild(textarea); textarea.select();
      try { const ok = document.execCommand('copy'); if (!ok) throw new Error(); toast('Price copied.'); } catch (err) { toast('Clipboard is unavailable in this browser. The price remains visible above.'); } finally { textarea.remove(); }
    }
  });
  function openSettings() {
    $('settings-error').hidden = true;
    populateSettings(settings); $('settings-dialog').showModal();
  }
  function populateSettings(s) {
    $('policy-name').value = s.policyName;
    const fields = { 'store-spot':'storeSpot','review-movement':'reviewMovement','breakpoint':'breakpoint','rounding':'rounding','min-margin':'minMargin','stale-minutes':'staleMinutes','calibration-spot':'calibrationSpot' };
    for (const [id,key] of Object.entries(fields)) $(id).value = s[key];
    $('reviewed').checked = s.reviewed;
    $('default-premiums').innerHTML = P.KARATS.map(k => '<div><label for="default-premium-' + k + '">' + k + 'K premium %</label><input id="default-premium-' + k + '" type="number" min="0" max="300" step="0.5" required value="' + s.rates[k].defaultPremium + '"></div>').join('');
    $('base-rates').innerHTML = P.KARATS.map(k => '<h4>' + k + 'K base rate card</h4><div class="form-three"><div><label for="base-first-' + k + '">First-tier $/g</label><input id="base-first-' + k + '" type="number" min="1" max="100000" step="0.01" required value="' + s.rates[k].first + '"></div><div><label for="base-extra-' + k + '">Additional $/g</label><input id="base-extra-' + k + '" type="number" min="1" max="100000" step="0.01" required value="' + s.rates[k].extra + '"></div><div><label for="base-premium-' + k + '">Anchor premium %</label><input id="base-premium-' + k + '" type="number" min="0" max="300" step="0.5" required value="' + s.rates[k].basePremium + '"></div></div><label class="checkbox-line"><input id="provisional-' + k + '" type="checkbox" ' + (s.rates[k].provisional ? 'checked' : '') + '><span>Mark ' + k + 'K retail rates as provisional</span></label>').join('');
  }
  function readSettingsForm() {
    const next = P.clone(settings);
    next.policyName = $('policy-name').value;
    for (const [id,key] of Object.entries({ 'store-spot':'storeSpot','review-movement':'reviewMovement','breakpoint':'breakpoint','rounding':'rounding','min-margin':'minMargin','stale-minutes':'staleMinutes','calibration-spot':'calibrationSpot' })) next[key] = $(id).value;
    next.reviewed = $('reviewed').checked; next.savedAt = new Date().toISOString();
    for (const k of P.KARATS) next.rates[k] = { first: $('base-first-' + k).value, extra: $('base-extra-' + k).value, basePremium: $('base-premium-' + k).value, defaultPremium: $('default-premium-' + k).value, provisional: $('provisional-' + k).checked };
    return P.validateSettings(next);
  }
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const next = readSettingsForm();
      if (!window.confirm('Save this pricing policy on this browser? It will change calculator results here, but will not update The Edge, your website, or other devices.')) return;
      settings = next; save('settings', settings);
      $('premium').value = settings.rates[selectedKarat()].defaultPremium;
      rememberInputs(); $('settings-dialog').close(); renderAll(); toast('Policy saved locally. Export it to transfer these settings to another device.');
    } catch (err) { $('settings-error').textContent = err.message; $('settings-error').hidden = false; }
  });
  $('settings-button').addEventListener('click', openSettings);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('export-settings').addEventListener('click', () => {
    const contents = { app: 'Arezzo Gold Studio', exportedAt: new Date().toISOString(), settings };
    const blob = new Blob([JSON.stringify(contents, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'arezzo-gold-policy.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Saved policy exported. Unsaved form changes are not included.');
  });
  $('import-settings').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Settings file is too large.');
      const data = JSON.parse(await file.text());
      if (data.app !== 'Arezzo Gold Studio') throw new Error('Not an Arezzo Gold Studio settings export.');
      const imported = P.validateSettings(data.settings);
      imported.reviewed = false;
      populateSettings(imported); $('settings-error').hidden = true;
      toast('Imported into the form only. Review it, then save to apply.');
    } catch (err) { $('settings-error').textContent = 'Import failed: ' + err.message; $('settings-error').hidden = false; }
    e.target.value = '';
  });
  $('reset-settings').addEventListener('click', () => { if (confirm('Load the starting draft into this form? Nothing changes until you save.')) { populateSettings(P.DEFAULTS); $('settings-error').hidden = true; } });
  $('copy-feed-details').addEventListener('click', async () => {
    const text = $('feed-debug').textContent;
    try { await navigator.clipboard.writeText(text); toast('Connection details copied.'); }
    catch (error) { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('feed-debug')); selection.removeAllRanges(); selection.addRange(range); toast('Details selected. Copy them or send a screenshot.'); }
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });
  $('install-button').addEventListener('click', async () => {
    if (state.installPrompt) { await state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; }
    else { $('help-dialog').showModal(); }
  });
  window.addEventListener('offline', () => { state.quoteTrusted = false; renderAll(); });
  window.addEventListener('online', () => { renderAll(); fetchQuote(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); fetchQuote(); } });
  window.addEventListener('storage', e => { if (e.key === KEY + 'settings') { storageIssue = 'The saved policy changed in another tab. Reload this page to use the updated settings.'; renderStorage(); } });
  setInterval(() => { if (!document.hidden) { renderMarket(); if (state.mode === 'live') renderCalculation(); } }, 1000);
  setInterval(() => { if (!document.hidden) fetchQuote(); }, 60000);
  if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol) && !window.AREZZO_STANDALONE) {
    navigator.serviceWorker.register('./sw.js').catch(() => { toast('Offline installation was unavailable. The calculator still works while this page is open.'); });
  }
  renderAll(); fetchQuote();
})();
