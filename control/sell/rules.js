"use strict";

const CATEGORY_KEYWORDS = [
  { key: "electronics", terms: ["voltage", "model", "adapter", "usb", "bluetooth", "charger", "device", "battery"] },
  { key: "tools", terms: ["wrench", "drill", "socket", "torque", "impact", "tool"] },
  { key: "apparel", terms: ["shirt", "jacket", "size", "cotton", "apparel", "hoodie"] },
  { key: "collectibles", terms: ["vintage", "collectible", "rare", "limited", "sealed", "card"] },
  { key: "home", terms: ["kitchen", "furniture", "home", "decor", "lamp"] },
];

const CATEGORY_FLOOR = Object.freeze({
  electronics: 29.99,
  tools: 24.99,
  apparel: 18.99,
  collectibles: 34.99,
  home: 22.99,
  unknown: 19.99,
});

const CHANNEL_RULES = Object.freeze({
  ebay: {
    fee_rate: 0.1325,
    fixed_fee: 0.3,
    local_only: false,
  },
  etsy: {
    fee_rate: 0.095, // transaction + processing
    fixed_fee: 0.45, // listing + fixed processing
    local_only: false,
  },
  craigslist: {
    fee_rate: 0,
    fixed_fee: 0,
    local_only: true,
  },
  facebook_marketplace: {
    fee_rate: 0.1,
    fixed_fee: 0.3,
    local_only: false,
  },
});

function tokenize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function inferPhotoRoles(mediaRows = []) {
  const roles = new Set();
  for (const m of mediaRows) {
    const t = String(m.file_path || "").toLowerCase();
    if (/front|hero|main/.test(t)) roles.add("front");
    if (/back|rear/.test(t)) roles.add("back");
    if (/label|sticker|serial|model/.test(t)) roles.add("label");
    if (/scale|ruler|coin|measure/.test(t)) roles.add("scale");
  }
  return roles;
}

function detectFlags(item, mediaRows = []) {
  const flags = [];
  const roleSet = inferPhotoRoles(mediaRows);
  if ((mediaRows || []).length < 3) flags.push("NEEDS_PHOTOS");
  if (!roleSet.has("label")) flags.push("NEEDS_LABEL_PHOTO");
  if (!roleSet.has("front")) flags.push("NEEDS_FRONT_PHOTO");
  if (["INGESTED", "NEW"].includes(item.status) && (mediaRows || []).length >= 3) {
    // no-op; extraction can proceed
  }
  return flags;
}

function inferCategory(item, mediaRows = []) {
  if (item.category) return item.category;
  const hay = [
    item.title,
    item.notes,
    ...mediaRows.map((m) => m.file_path || ""),
  ].join(" ").toLowerCase();
  let best = { key: "unknown", score: 0 };
  for (const c of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const term of c.terms) if (hay.includes(term)) score += 1;
    if (score > best.score) best = { key: c.key, score };
  }
  return best.key;
}

function classifyTraits(item, category) {
  const note = String(item.notes || "").toLowerCase();
  return {
    handmade: /\bhandmade\b/.test(note),
    vintage: /\bvintage\b|20\+?\s*years?\s*old/.test(note),
    craftSupply: /\bcraft\s*supply|supply\b/.test(note),
    localPickupPreferred: /\blocal|pickup|pick-up|no\s+ship/.test(note),
    oversizeOrHeavy:
      /\bheavy|oversize|oversized|bulky|furniture|appliance/.test(note) ||
      category === "home",
  };
}

function channelMarginEstimate(item, channel, listPrice) {
  const rule = CHANNEL_RULES[channel] || CHANNEL_RULES.ebay;
  const note = String(item.notes || "").toLowerCase();
  const cogs = Number(process.env.SELL_DEFAULT_COGS_USD || "0");
  const baseShip = Number(process.env.SELL_DEFAULT_SHIPPING_USD || "9");
  const heavyShip = Number(process.env.SELL_HEAVY_SHIPPING_USD || "28");
  const minMargin = Number(process.env.SELL_MIN_MARGIN_USD || "5");

  const isHeavy = /\bheavy|oversize|oversized|bulky|furniture|appliance/.test(note);
  const shipping = rule.local_only ? 0 : (isHeavy ? heavyShip : baseShip);
  const fees = (listPrice * rule.fee_rate) + rule.fixed_fee;
  const expectedNet = listPrice - fees - shipping - cogs;

  return {
    channel,
    expected_net: Number(expectedNet.toFixed(2)),
    estimated_fees: Number(fees.toFixed(2)),
    estimated_shipping: Number(shipping.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    floor_margin: Number(minMargin.toFixed(2)),
    passes_margin_guard: expectedNet >= minMargin,
  };
}

function chooseChannels(item, category, flags = [], pricing = { list_price: 0 }) {
  const preferred = Array.isArray(item.preferred_channels) ? item.preferred_channels : [];
  const traits = classifyTraits(item, category);
  const reasons = [];
  const scores = new Map([
    ["ebay", 0],
    ["etsy", 0],
    ["craigslist", 0],
    ["facebook_marketplace", 0],
  ]);

  // Default: eBay first for broad physical goods.
  scores.set("ebay", scores.get("ebay") + 100);
  reasons.push("default_ebay_primary");

  // Etsy only when handmade/craft/vintage intent is present.
  if (traits.handmade || traits.vintage || traits.craftSupply) {
    scores.set("etsy", scores.get("etsy") + 110);
    reasons.push("etsy_eligible_handmade_craft_vintage");
  }

  // Local lanes for bulky/pickup-intent items.
  if (traits.localPickupPreferred || traits.oversizeOrHeavy || flags.includes("HEAVY_SHIPPING_RISK")) {
    scores.set("craigslist", scores.get("craigslist") + 95);
    scores.set("facebook_marketplace", scores.get("facebook_marketplace") + 80);
    reasons.push("local_lane_for_bulky_or_pickup");
  }

  for (const c of preferred) {
    if (scores.has(c)) scores.set(c, scores.get(c) + 5);
  }

  // Eligibility hard-filters.
  if (!(traits.handmade || traits.vintage || traits.craftSupply)) scores.set("etsy", 0);
  if (!(traits.localPickupPreferred || traits.oversizeOrHeavy || flags.includes("HEAVY_SHIPPING_RISK"))) {
    scores.set("craigslist", 0);
  }

  const ranked = Array.from(scores.entries())
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([channel, priority]) => ({ channel, priority }));

  const marginByChannel = {};
  const blocked = [];
  const channels = [];
  for (const entry of ranked) {
    const margin = channelMarginEstimate(item, entry.channel, Number(pricing.list_price || 0));
    marginByChannel[entry.channel] = margin;
    if (!margin.passes_margin_guard) {
      blocked.push({ channel: entry.channel, reason: "expected_net_below_floor_margin", ...margin });
      continue;
    }
    channels.push(entry.channel);
  }

  return {
    channels,
    ranked_channels: ranked,
    blocked_channels: blocked,
    margin_by_channel: marginByChannel,
    reasons,
    strategy:
      traits.handmade || traits.vintage || traits.craftSupply
        ? "etsy_first_if_eligible_else_ebay"
        : (traits.localPickupPreferred || traits.oversizeOrHeavy
          ? "local_first_craigslist_fb_then_ebay"
          : "ebay_first"),
  };
}

function pricingPolicyToMode(policy) {
  if (policy === "liquidate") return { percentile: 0.3, discount: 0.88 };
  if (policy === "max_margin") return { percentile: 0.75, discount: 1.06 };
  return { percentile: 0.5, discount: 1.0 };
}

function computePrice(item, category) {
  const policy = pricingPolicyToMode(item.price_policy || "normal");
  const floor = CATEGORY_FLOOR[category] || CATEGORY_FLOOR.unknown;
  const anchor = floor * (1 + policy.percentile);
  const raw = anchor * policy.discount;
  const listPrice = Math.max(floor, Math.round(raw) - 0.01);
  const fast = Math.max(floor, Math.round((listPrice * 0.85)) - 0.01);
  const max = Math.max(floor, Math.round((listPrice * 1.2)) - 0.01);
  return {
    list_price: Number(listPrice.toFixed(2)),
    floor_price: Number(floor.toFixed(2)),
    price_fast: Number(fast.toFixed(2)),
    price_max: Number(max.toFixed(2)),
  };
}

function canonicalTitle(item, category) {
  const base = tokenize(item.title || item.notes || "").slice(0, 10).join(" ");
  const prefix = category === "unknown" ? "Product" : category[0].toUpperCase() + category.slice(1);
  const sku = item.sku || "ITEM";
  return `${prefix} ${base || "listing"} ${sku}`.trim().slice(0, 80);
}

function listingTemplate(item, channel, category, pricing, flags = []) {
  const title = canonicalTitle(item, category);
  const specifics = {
    condition: flags.includes("NEEDS_PHOTOS") ? "Unknown" : "Used",
    category,
    sku: item.sku,
    velocity: item.desired_velocity,
  };
  const description = [
    `Item: ${title}`,
    `Category: ${category}`,
    `Condition: ${specifics.condition}`,
    `Price Strategy: ${item.price_policy}`,
    `List Price: $${pricing.list_price.toFixed(2)}`,
    pricing.margin_by_channel && pricing.margin_by_channel[channel]
      ? `Expected Net (${channel}): $${Number(pricing.margin_by_channel[channel].expected_net || 0).toFixed(2)}`
      : "",
    item.notes ? `Notes: ${item.notes}` : "",
    "",
    "Shipping and returns are applied per channel policy.",
  ].filter(Boolean).join("\n");
  return {
    channel,
    title: channel === "ebay" ? title.slice(0, 80) : title,
    description,
    specifics,
    listing_packet_json: {
      channel,
      title,
      description,
      specifics,
      pricing,
      flags,
    },
  };
}

module.exports = {
  detectFlags,
  inferCategory,
  chooseChannels,
  computePrice,
  listingTemplate,
  canonicalTitle,
};
