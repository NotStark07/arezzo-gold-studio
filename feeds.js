/* Timestamped gold quotes only. No item inputs or saved pricing settings are sent. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing.js'));
  else root.ArezzoFeeds = factory(root.ArezzoPricing);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const PROVIDERS = Object.freeze([
    Object.freeze({ id: 'gold-api', name: 'Gold API', url: 'https://api.gold-api.com/price/XAU', minInterval: 30000 }),
    Object.freeze({ id: 'xaus', name: 'XAUS backup', url: 'https://xaus.com/api/v1/spot?compact=1', minInterval: 60000 })
  ]);
  function providerById(id) { return PROVIDERS.find(p => p.id === id); }
  function normalizeQuote(provider, payload, receivedAt) {
    if (!providerById(provider.id) || !payload || typeof payload !== 'object') throw new Error('Unrecognized price response.');
    let raw, providerStale = false;
    if (provider.id === 'gold-api') {
      raw = payload;
    } else {
      const status = payload.data_state && payload.data_state.status;
      if (status && !['fresh', 'stale', 'unavailable'].includes(status)) throw new Error('Unrecognized backup data status.');
      if (status === 'unavailable') throw new Error('Backup has no gold quotation.');
      if (payload.xau && (payload.xau.currency !== 'USD' || !['troy_oz', 'oz'].includes(payload.xau.unit))) throw new Error('Backup currency or unit is not USD per troy ounce.');
      // Use the price's time, NEVER the time a server generated a new response.
      const priceTime = payload.data_state && payload.data_state.as_of || payload.price_as_of;
      if (!priceTime) throw new Error('Backup has no gold-price timestamp.');
      providerStale = payload.stale === true || status === 'stale';
      raw = {symbol: 'XAU', currency: 'USD', price: payload.spot_usd_oz, updatedAt: priceTime};
    }
    const quote = P.parseQuote(raw, receivedAt);
    return { ...quote, provider: provider.id, source: provider.name, unit: 'troy_oz', providerStale };
  }
  function restoreQuote(saved, now) {
    const provider = providerById(saved && saved.provider || 'gold-api');
    if (!provider) throw new Error('Unknown cached source.');
    const q = P.parseQuote(saved, now);
    return { ...q, receivedAt: typeof saved.receivedAt === 'string' && Number.isFinite(Date.parse(saved.receivedAt)) ? saved.receivedAt : q.receivedAt,
      provider: provider.id, source: provider.name, unit: 'troy_oz', providerStale: saved.providerStale === true };
  }
  function explainError(error) {
    if (error && error.name === 'AbortError') return 'Connection timed out.';
    if (error && error.name === 'TypeError') return 'Browser could not reach the feed (network, DNS, extension, or browser-origin restriction).';
    return error && error.message ? error.message : 'Connection failed.';
  }
  function createClient(options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || globalThis.fetch.bind(globalThis);
    const clock = opts.now || Date.now;
    const timeoutMs = opts.timeoutMs || 7000;
    const cache = new Map();
    async function request(provider) {
      const previous = cache.get(provider.id);
      if (previous && clock() - previous.at < provider.minInterval) {
        if (previous.error) throw previous.error;
        return {quote: previous.quote, reused: true};
      }
      const entry = {at: clock(), quote: null, error: null};
      cache.set(provider.id, entry);
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('Connection timed out.'); error.name = 'AbortError'; reject(error);
        }, timeoutMs);
      });
      try {
        const operation = (async () => {
          // Simple anonymous GET: no API key, custom headers, or no-cache headers.
          // Let the provider's cache TTL work; validate the quote timestamp below.
          const response = await fetchImpl(provider.url, {signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
          if (!response.ok) throw new Error('Provider returned HTTP ' + response.status + '.');
          let data;
          try { data = await response.json(); }
          catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Provider did not return valid JSON.'); }
          return normalizeQuote(provider, data, clock());
        })();
        entry.quote = await Promise.race([operation, deadline]);
        return {quote: entry.quote, reused: false};
      } catch (error) { entry.error = error; throw error; }
      finally { clearTimeout(timer); }
    }
    async function getLatest(staleMinutes, onAttempt) {
      const attempts = [], staleQuotes = [];
      for (const provider of PROVIDERS) {
        if (onAttempt) onAttempt(provider);
        try {
          const result = await request(provider);
          const status = P.quoteState(result.quote, clock(), staleMinutes);
          attempts.push({provider: provider.name, url: provider.url, checkedAt: new Date(clock()).toISOString(),
            result: status.fresh ? (result.reused ? 'Fresh verified quote reused within provider cache interval.' : 'Fresh timestamped quote received.') : 'Quote is stale or flagged stale by the provider; live pricing blocked.',
            quotedAt: result.quote.updatedAt});
          if (status.fresh) return {quote: result.quote, fresh: true, attempts};
          staleQuotes.push(result.quote);
        } catch (error) {
          attempts.push({provider: provider.name, url: provider.url, checkedAt: new Date(clock()).toISOString(), result: explainError(error)});
        }
      }
      staleQuotes.sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return {quote: staleQuotes[0] || null, fresh: false, attempts};
    }
    return {getLatest};
  }
  return {PROVIDERS, normalizeQuote, restoreQuote, createClient, explainError};
});
