#!/usr/bin/env node
"use strict";

/**
 * start-whatsapp-payments.js
 * 
 * Starts the ClawPay WhatsApp payment server with verification
 */

require("dotenv").config({ override: true });

const { startWebhookServer } = require("./payment-router");
const botCommerce = require("./bot-commerce");

console.log("=".repeat(60));
console.log("🚀 Starting ClawPay WhatsApp Payment Server");
console.log("=".repeat(60));

// Verify required environment variables
const required = {
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  COMMERCE_PUBLIC_URL: process.env.COMMERCE_PUBLIC_URL,
};

const missing = Object.entries(required)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error("\n❌ Missing required environment variables:");
  missing.forEach(key => console.error(`   - ${key}`));
  console.error("\n💡 Add these to your .env file and try again.\n");
  process.exit(1);
}

console.log("\n✅ All environment variables are set!");
console.log(`\n📱 WhatsApp:`);
console.log(`   Phone Number ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID}`);
console.log(`   Business Account ID: ${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || 'Not set'}`);
console.log(`\n💳 Stripe:`);
console.log(`   Public URL: ${process.env.COMMERCE_PUBLIC_URL}`);
console.log(`   Webhook: ${process.env.COMMERCE_PUBLIC_URL}/webhooks/stripe`);
console.log(`\n🔗 WhatsApp Webhook:`);
console.log(`   URL: ${process.env.COMMERCE_PUBLIC_URL}/webhooks/whatsapp`);
console.log(`   Verify Token: ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN}`);

// Enable WhatsApp commerce webhook handler
if (typeof botCommerce.enableWhatsAppCommerceWebhook === "function") {
  botCommerce.enableWhatsAppCommerceWebhook();
} else {
  // Fallback: the function is called automatically in standalone mode
  console.log("⚠️  WhatsApp handler will be enabled when bot-commerce starts");
}

// Start the webhook server
const server = startWebhookServer();

const PORT = Number(process.env.COMMERCE_PORT || "3031");

console.log(`\n✅ Server started on port ${PORT}`);
console.log(`\n📋 Webhook URLs to configure:`);
console.log(`\n   Meta Business Manager:`);
console.log(`   → WhatsApp → Configuration → Webhook`);
console.log(`   → Callback URL: ${process.env.COMMERCE_PUBLIC_URL}/webhooks/whatsapp`);
console.log(`   → Verify Token: ${process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN}`);
console.log(`\n   Stripe Dashboard:`);
console.log(`   → Developers → Webhooks → Add endpoint`);
console.log(`   → URL: ${process.env.COMMERCE_PUBLIC_URL}/webhooks/stripe`);
console.log(`   → Events: checkout.session.completed, checkout.session.async_payment_succeeded`);
console.log(`\n🧪 Test by sending 'oracle' to your WhatsApp Business number`);
console.log(`\n💡 You have 24 hours of free messaging - use it to test!`);
console.log("\n" + "=".repeat(60));

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server stopped");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server stopped");
    process.exit(0);
  });
});
