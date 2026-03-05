/**
 * SkynPatch Product Catalog
 * Matches Stripe products created by stripe-setup-products.js / stripe-add-skus.js
 * UPC barcodes scanned from 50-pack wholesale cases (GS1 prefix 0085005)
 *
 * 7 individual SKUs confirmed in-hand (60+ cases each, ships immediately):
 *   zzzzz        → Sleep Support        $250/case
 *   ignite       → Energy Support       $250/case
 *   longevity    → Vitality Support     $250/case
 *   synergy      → Digestive+Immune     $250/case
 *   pre_party    → Recovery Support     $250/case  ← confirmed from product label
 *   crave        → Date Night Support   $625/case
 *   sku_006      → TBD (UPC 528)        $250/case  ← scan label to confirm name
 *   sku_007      → Zzzzzz Sleep Support (UPC 474)  $250/case
 *   starter_bundle → All 4 core SKUs   $900/bundle
 *
 * Volume pricing: room to adjust per-case price on quantity.
 *   1–2 cases:  $250/case (standard)
 *   3–5 cases:  ~$235/case (negotiate, use Stripe promo code)
 *   6+ cases:   ~$220/case (negotiate, use Stripe promo code)
 * Enable via Stripe Dashboard → Coupons, codes like BULK3, BULK6.
 *
 * Next production run: 5–6 weeks out. Current stock ships in 2 business days.
 */

// ─── Core wholesale products ──────────────────────────────────────────────
// keys MUST match stripe-setup-products.js / stripe-add-skus.js PRODUCTS arrays
const SKYNPATCH_PRODUCTS = [
  {
    key:              'zzzzz',
    stripe_sku:       'SP-SLEEP-CASE',
    name:             'Zzzzz — Sleep Support',
    tagline:          'Fall asleep faster, wake refreshed',
    ingredients:      'Melatonin, L-Theanine, Magnesium, Passionflower, 5-HTP',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,   // 50 × $11.96
    margin_pct:       58,
    upc:              '00850053954511',
    in_stock:         true,
  },
  {
    key:              'ignite',
    stripe_sku:       'SP-ENERGY-CASE',
    name:             'Ignite — Energy Support',
    tagline:          'All-day energy without stimulants or crashes',
    ingredients:      'Vitamin B12, L-Carnitine, CoQ10, Rhodiola Rosea, Magnesium',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,
    margin_pct:       58,
    upc:              '00850053954481',
    in_stock:         true,
  },
  {
    key:              'longevity',
    stripe_sku:       'SP-VITAL-CASE',
    name:             'Longevity — Vitality Support',
    tagline:          'Daily cellular anti-aging support',
    ingredients:      'NAD+, NMN, NR, Resveratrol, Vitamin B Complex, Curcumin, Glutathione',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,
    margin_pct:       58,
    upc:              '00850053954535',
    in_stock:         true,
  },
  {
    key:              'synergy',
    stripe_sku:       'SP-IMMUN-CASE',
    name:             'Synergy — Digestive & Immunity Support',
    tagline:          'Gut health and immune response',
    ingredients:      'Vitamin B6, B12, Magnesium, Zinc, Lactobacillus Acidophilus, Curcumin',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,
    margin_pct:       58,
    upc:              '00850053954498',
    in_stock:         true,
  },
  {
    // Confirmed from physical product label visible in sales sheet.
    // Ingredients: Milk Thistle, N-Acetyl Cysteine, Vitamin B Complex,
    //              Alpha Lipoic Acid, Electrolytes
    key:              'pre_party',
    stripe_sku:       'SP-RECOV-CASE',
    name:             'Pre-Party — Recovery Support',
    tagline:          'Event prep and next-day recovery support',
    ingredients:      'Milk Thistle, N-Acetyl Cysteine, Vitamin B Complex, Alpha Lipoic Acid, Electrolytes',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,
    margin_pct:       58,
    upc:              '00850053954528',  // confirmed — matches Pre-Party case barcode
    in_stock:         true,
    // stripe_pending cleared — prod_U3DID8N1eE6QJ0 live at https://buy.stripe.com/3cIbJ2b5p2cw54mdGm00005
  },
  {
    // Confirmed from barcode file:
    // .../skynpatch/barcode/case/zzzzzz case00850053954474 ITF-14 SST2.png
    // This is a second Sleep Support case with a distinct ITF-14/UPC-A barcode —
    // same formula as 'zzzzz' but separate GS1 item number (different pack/lot variant).
    // Stripe key: sku_007 (used in stripe-add-skus.js) — added by PM2 salesops job.
    key:              'sku_007',
    stripe_sku:       'SP-SLEEP2-CASE',
    name:             'Zzzzzz — Sleep Support (Variant)',
    tagline:          'Fall asleep faster, wake refreshed',
    ingredients:      'Melatonin, L-Theanine, Magnesium, Passionflower, 5-HTP',
    case_qty:         50,
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  250.00,
    msrp_retail_case: 598.00,
    margin_pct:       58,
    upc:              '00850053954474',
    in_stock:         true,
    // stripe_pending — will be created by claw-salesops-maintenance PM2 job (runs daily 8:30am)
  },
  {
    key:              'crave',
    stripe_sku:       'SP-CRAVE-CASE',
    name:             'Crave — Adults-Only Date Night Self-Care',
    tagline:          'Date-night mood, confidence, and intimacy support',
    ingredients:      'Date-night self-care blend',
    case_qty:         50,
    patches_per_pack: 6,
    msrp_per_pack:    29.96,
    wholesale_price:  625.00,
    msrp_retail_case: 1498.00,  // 50 × $29.96
    margin_pct:       58,
    upc:              'CRAVE-PENDING-UPC',
    in_stock:         true,
  },
  {
    key:              'starter_bundle',
    stripe_sku:       'SP-BUNDLE-4SKU',
    name:             'SkynPatch Starter Bundle — All 4 Core SKUs',
    tagline:          'Low-risk retail test with shelf-ready display',
    ingredients:      'Zzzzz, Ignite, Longevity, Synergy (1 case each)',
    case_qty:         200,      // 4 × 50 packs
    patches_per_pack: 4,
    msrp_per_pack:    11.96,
    wholesale_price:  900.00,   // saves $100 vs 4 individual cases ($1,000)
    msrp_retail_case: 2392.00,  // 200 × $11.96
    margin_pct:       62,
    upc:              '00850053954504',
    in_stock:         true,
  },
];

// ─── UPC registry ─────────────────────────────────────────────────────────
// All 7 UPCs scanned from physical cases (GS1 brand prefix: 0085005)
const UNMAPPED_UPCS = [
  // Keep empty unless a future barcode is discovered without a product mapping.
];

// ─── Quick lookups ────────────────────────────────────────────────────────
const PRODUCTS_BY_KEY    = Object.fromEntries(SKYNPATCH_PRODUCTS.map(p => [p.key, p]));
const PRODUCTS_BY_UPC    = Object.fromEntries(SKYNPATCH_PRODUCTS.map(p => [p.upc, p]));
const PRODUCTS_BY_SKU    = Object.fromEntries(SKYNPATCH_PRODUCTS.map(p => [p.stripe_sku, p]));

/**
 * Load live Stripe IDs from .stripe-products.json (generated by stripe-setup-products.js)
 * Returns merged product list with productId, priceId, paymentLinkId, url fields populated.
 */
function loadWithStripeIds(stripeProductsPath) {
  const fs   = require('fs');
  const path = require('path');
  const file = stripeProductsPath || path.join(__dirname, '../.stripe-products.json');
  if (!fs.existsSync(file)) return SKYNPATCH_PRODUCTS;

  const stripe = JSON.parse(fs.readFileSync(file, 'utf8'));
  return SKYNPATCH_PRODUCTS.map(p => {
    const s = stripe[p.key] || {};
    return {
      ...p,
      stripe_product_id:    s.productId    || null,
      stripe_price_id:      s.priceId      || null,
      stripe_payment_link:  s.paymentLinkId || null,
      checkout_url:         s.url          || null,
    };
  });
}

/**
 * Get a product's checkout URL from .stripe-products.json by key.
 * Used by email templates: {{checkout_url}}
 */
function getCheckoutUrl(productKey) {
  const products = loadWithStripeIds();
  const p = products.find(x => x.key === productKey);
  return p ? p.checkout_url : null;
}

/**
 * Build the margin table string used in emails/sales sheets.
 * e.g. "Buy at $250 → sell at ~$598 → ~58% margin"
 */
function marginLine(productKey) {
  const p = PRODUCTS_BY_KEY[productKey];
  if (!p) return '';
  return `Buy at $${p.wholesale_price.toFixed(0)} → sell ${p.case_qty} packs × $${p.msrp_per_pack} MSRP → ~$${p.msrp_retail_case.toFixed(0)} retail (~${p.margin_pct}% margin)`;
}

module.exports = {
  SKYNPATCH_PRODUCTS,
  UNMAPPED_UPCS,
  PRODUCTS_BY_KEY,
  PRODUCTS_BY_UPC,
  PRODUCTS_BY_SKU,
  loadWithStripeIds,
  getCheckoutUrl,
  marginLine,
};
