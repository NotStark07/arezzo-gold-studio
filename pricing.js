/* Arezzo Gold Studio: pure pricing functions shared by the browser and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArezzoPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GRAMS_PER_TROY_OUNCE = 31.1034768;
  const KARATS = [10, 14, 18];
  const DEFAULTS = {
    schemaVersion: 1,
    policyName: 'Arezzo starting policy',
    reviewed: false,
    savedAt: null,
    calibrationSpot: 4500,
    storeSpot: 4500,
    breakpoint: 10,
    rounding: 5,
    reviewMovement: 500,
    staleMinutes: 5,
    minMargin: 30,
    rates: {
      '10': { first: 190, extra: 150, basePremium: 35, defaultPremium: 35, provisional: true },
      '14': { first: 220, extra: 180, basePremium: 35, defaultPremium: 35, provisional: false },
      '18': { first: 270, extra: 220, basePremium: 35, defaultPremium: 35, provisional: false }
    }
  };
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function num(value, name, min, max) {
    if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) throw new Error(name + ' is required.');
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(name + ' must be between ' + min + ' and ' + max + '.');
    return n;
  }
  function validateSettings(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw new Error('Unsupported settings file. Expected Arezzo policy version 1.');
    const v = clone(DEFAULTS);
    v.policyName = String(value.policyName || 'Arezzo policy').trim().slice(0, 64);
    v.reviewed = value.reviewed === true;
    v.savedAt = value.savedAt && Number.isFinite(Date.parse(value.savedAt)) ? new Date(value.savedAt).toISOString() : null;
    v.calibrationSpot = num(value.calibrationSpot, 'Calibration gold price', 100, 100000);
    v.storeSpot = num(value.storeSpot, 'Store gold reference', 100, 100000);
    v.breakpoint = num(value.breakpoint, 'Weight breakpoint', 1, 1000);
    v.rounding = num(value.rounding, 'Rounding increment', 1, 1000);
    v.reviewMovement = num(value.reviewMovement, 'Reference review movement', 50, 10000);
    v.staleMinutes = num(value.staleMinutes, 'Quote freshness limit', 1, 30);
    v.minMargin = num(value.minMargin, 'Review margin', 0, 90);
    for (const k of KARATS) {
      const r = value.rates && value.rates[k];
      if (!r) throw new Error('Missing ' + k + 'K rate settings.');
      v.rates[k] = {
        first: num(r.first, k + 'K first rate', 1, 100000),
        extra: num(r.extra, k + 'K additional rate', 1, 100000),
        basePremium: num(r.basePremium, k + 'K calibration premium', 0, 300),
        defaultPremium: num(r.defaultPremium, k + 'K supplier premium', 0, 300),
        provisional: r.provisional === true
      };
      if (v.rates[k].extra > v.rates[k].first) throw new Error(k + 'K additional-gram rate cannot exceed its first-tier rate.');
    }
    return v;
  }
  function intrinsic(spot, karat) {
    const s = num(spot, 'Gold reference', 100, 100000);
    const k = num(karat, 'Karat', 10, 18);
    if (!KARATS.includes(k)) throw new Error('Choose 10K, 14K or 18K.');
    return s / GRAMS_PER_TROY_OUNCE * k / 24;
  }
  function replacement(spot, karat, premium) {
    return intrinsic(spot, karat) * (1 + num(premium, 'Supplier premium', 0, 300) / 100);
  }
  function adjustedRates(settings, karat, spot, premium) {
    const k = Number(karat);
    const r = settings.rates[k];
    if (!r) throw new Error('Choose 10K, 14K or 18K.');
    const metal = intrinsic(spot, k);
    const cost = replacement(spot, k, premium);
    const calibrationCost = replacement(settings.calibrationSpot, k, r.basePremium);
    const delta = cost - calibrationCost;
    return { metal, cost, calibrationCost, delta, first: r.first + delta, extra: r.extra + delta, provisional: r.provisional };
  }
  function roundUp(amount, increment) {
    // A tiny epsilon prevents floating-point noise from adding a whole increment.
    return Math.ceil(amount / increment - 1e-9) * increment;
  }
  function calculate(settings, input) {
    const weight = num(input.weight, 'Weight in grams', 0.01, 10000);
    const karat = num(input.karat, 'Karat', 10, 18);
    const premium = num(input.premium, 'Supplier premium', 0, 300);
    const spot = num(input.spot, 'Gold reference', 100, 100000);
    const rates = adjustedRates(settings, karat, spot, premium);
    if (rates.first <= 0 || rates.extra <= 0) throw new Error('An adjusted rate is zero or negative. Review the policy calibration.');
    const firstWeight = Math.min(weight, settings.breakpoint);
    const extraWeight = Math.max(0, weight - settings.breakpoint);
    const firstAmount = firstWeight * rates.first;
    const extraAmount = extraWeight * rates.extra;
    const unrounded = firstAmount + extraAmount;
    const price = roundUp(unrounded, settings.rounding);
    const replacementCost = weight * rates.cost;
    const goldValue = weight * rates.metal;
    const historicalCost = (input.historicalCost === '' || input.historicalCost === undefined || input.historicalCost === null) ? null : num(input.historicalCost, 'Historical cost', 0, 1000000000);
    const costFloor = Math.max(replacementCost, historicalCost || 0);
    const scope = input.scope || 'solid';
    const warnings = [];
    if (!settings.reviewed) warnings.push({ code: 'draft', text: 'Working draft: the $4,500 calibration and starting rates require your review before rollout.' });
    if (rates.provisional) warnings.push({ code: 'provisional', text: karat + 'K rates are provisional. Confirm market pricing and supplier costs before using this as a selling price.' });
    if (weight < 1) warnings.push({ code: 'small', text: 'Under 1 gram: outside the standard schedule. The displayed amount is a formula estimate, not an approved price.' });
    if (scope !== 'solid') warnings.push({ code: 'scope', text: 'Nonstandard or unconfirmed construction: review separately. Do not apply this ordinary solid-gold schedule automatically.' });
    if (Math.abs(spot - settings.calibrationSpot) >= 1000) warnings.push({ code: 'calibration', text: 'Gold is at least $1,000/oz from the calibration. Review the retail allowance and market fit.' });
    const discounts = [0, 15, 20].map(function (discount) {
      const sellingPrice = price * (1 - discount / 100);
      const spread = sellingPrice - replacementCost;
      const margin = spread / sellingPrice;
      const reviewMargin = (sellingPrice - costFloor) / sellingPrice;
      return { discount, price: sellingPrice, spread, margin, reviewMargin, low: reviewMargin < settings.minMargin / 100 };
    });
    if (discounts[0].low) warnings.push({ code: 'margin', text: 'Below the ' + settings.minMargin + '% review threshold against the higher of replacement or entered historical cost. This is before fees and overhead.' });
    const belowCost = price < replacementCost;
    if (belowCost) warnings.push({ code: 'cost', text: 'Formula price is below estimated replacement cost. Do not use without review.' });
    return { weight, karat, premium, spot, rates, firstWeight, extraWeight, firstAmount, extraAmount, unrounded, price, pricePerGram: price / weight, replacementCost, goldValue, spread: price - replacementCost, margin: (price - replacementCost) / price, historicalCost, historicalProfit: historicalCost === null ? null : price - historicalCost, roundingAdded: price - unrounded, discounts, warnings };
  }
  function parseQuote(payload, receivedAt) {
    const now = receivedAt === undefined ? Date.now() : receivedAt;
    if (!payload || payload.symbol !== 'XAU') throw new Error('Provider did not return XAU gold.');
    if (payload.currency && payload.currency !== 'USD') throw new Error('Provider quotation is not in USD.');
    const price = num(payload.price, 'Provider gold price', 100, 100000);
    const timestamp = Date.parse(payload.updatedAt);
    if (!Number.isFinite(timestamp)) throw new Error('Provider quotation has no valid timestamp.');
    if (timestamp > now + 120000) throw new Error('Provider quote time is in the future. Check device time.');
    return { price, symbol: 'XAU', currency: 'USD', updatedAt: new Date(timestamp).toISOString(), receivedAt: new Date(now).toISOString(), source: 'Gold API' };
  }
  function quoteState(quote, now, staleMinutes) {
    if (!quote) return { fresh: false, ageMs: null, reason: 'missing' };
    if (quote.providerStale === true) return { fresh: false, ageMs: now - Date.parse(quote.updatedAt), reason: 'provider-stale' };
    const age = now - Date.parse(quote.updatedAt);
    if (!Number.isFinite(age) || age < -120000) return { fresh: false, ageMs: age, reason: 'timestamp' };
    return { fresh: age <= staleMinutes * 60000, ageMs: Math.max(0, age), reason: age <= staleMinutes * 60000 ? 'fresh' : 'stale' };
  }
  return { GRAMS_PER_TROY_OUNCE, KARATS, DEFAULTS, clone, num, validateSettings, intrinsic, replacement, adjustedRates, roundUp, calculate, parseQuote, quoteState };
});
