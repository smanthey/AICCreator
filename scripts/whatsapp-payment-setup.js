#!/usr/bin/env node
"use strict";

/**
 * whatsapp-payment-setup.js
 * 
 * Verifies WhatsApp + Stripe payment setup and starts the webhook server
 * for ClawPay WhatsApp messaging to collect payments.
 */

require("dotenv").config({ override: true });

const requiredEnvVars = {
  whatsapp: [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  ],
  stripe: [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "COMMERCE_PUBLIC_URL",
  ],
};

function checkEnvVars() {
  const missing = [];
  const present = [];

  for (const [category, vars] of Object.entries(requiredEnvVars)) {
    for (const varName of vars) {
      if (process.env[varName]) {
        present.push({ category, varName, value: "***" });
      } else {
        missing.push({ category, varName });
      }
    }
  }

  console.log("\n📋 Environment Variables Check:\n");
  
  if (present.length > 0) {
    console.log("✅ Present:");
    for (const { category, varName } of present) {
      console.log(`   ${category.toUpperCase()}: ${varName}`);
    }
  }

  if (missing.length > 0) {
    console.log("\n❌ Missing:");
    for (const { category, varName } of missing) {
      console.log(`   ${category.toUpperCase()}: ${varName}`);
    }
    console.log("\n⚠️  Add missing variables to your .env file");
    return false;
  }

  console.log("\n✅ All required environment variables are set!");
  return true;
}

function checkWhatsAppConfig() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const publicUrl = process.env.COMMERCE_PUBLIC_URL;

  console.log("\n📱 WhatsApp Configuration:\n");
  console.log(`   Phone Number ID: ${phoneId ? "✅ Set" : "❌ Missing"}`);
  console.log(`   Access Token: ${token ? "✅ Set" : "❌ Missing"}`);
  console.log(`   Webhook Verify Token: ${verifyToken ? "✅ Set" : "❌ Missing"}`);
  console.log(`   Public URL: ${publicUrl || "❌ Missing"}`);

  if (publicUrl) {
    console.log(`\n   Webhook URL: ${publicUrl}/webhooks/whatsapp`);
    console.log(`   ⚠️  Make sure this URL is configured in Meta Business Manager:`);
    console.log(`      WhatsApp → Configuration → Webhook`);
    console.log(`      Callback URL: ${publicUrl}/webhooks/whatsapp`);
    console.log(`      Verify Token: ${verifyToken}`);
  }
}

function checkStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publicUrl = process.env.COMMERCE_PUBLIC_URL;

  console.log("\n💳 Stripe Configuration:\n");
  console.log(`   Secret Key: ${secretKey ? "✅ Set" : "❌ Missing"}`);
  console.log(`   Webhook Secret: ${webhookSecret ? "✅ Set" : "❌ Missing"}`);

  if (publicUrl && webhookSecret) {
    console.log(`\n   Webhook URL: ${publicUrl}/webhooks/stripe`);
    console.log(`   ⚠️  Make sure this webhook is configured in Stripe Dashboard:`);
    console.log(`      Developers → Webhooks → Add endpoint`);
    console.log(`      URL: ${publicUrl}/webhooks/stripe`);
    console.log(`      Events: checkout.session.completed, checkout.session.async_payment_succeeded`);
  }
}

async function testWhatsAppConnection() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.log("\n⚠️  Cannot test WhatsApp connection - missing credentials");
    return false;
  }

  console.log("\n🧪 Testing WhatsApp API connection...\n");

  try {
    // Test by fetching phone number info
    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log("✅ WhatsApp API connection successful!");
      console.log(`   Phone Number: ${data.display_phone_number || "N/A"}`);
      console.log(`   Verified Name: ${data.verified_name || "N/A"}`);
      return true;
    } else {
      const error = await response.text();
      console.log(`❌ WhatsApp API connection failed: HTTP ${response.status}`);
      console.log(`   Error: ${error}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ WhatsApp API connection error: ${err.message}`);
    return false;
  }
}

function showNextSteps() {
  console.log("\n🚀 Next Steps:\n");
  console.log("1. Start the webhook server:");
  console.log("   npm run commerce:server");
  console.log("   OR");
  console.log("   node scripts/bot-commerce.js");
  console.log("\n2. Test WhatsApp messaging:");
  console.log("   Send 'oracle' to your WhatsApp Business number");
  console.log("   Follow the prompts to create a payment link");
  console.log("\n3. Monitor payments:");
  console.log("   npm run commerce:pending");
  console.log("\n4. Check webhook health:");
  console.log("   curl http://localhost:3031/health");
  console.log("\n💡 Remember: You have 24 hours of free messaging after approval!");
  console.log("   Use this time to test the full payment flow.\n");
}

async function main() {
  console.log("=".repeat(60));
  console.log("ClawPay WhatsApp Payment Setup Verification");
  console.log("=".repeat(60));

  const allSet = checkEnvVars();
  checkWhatsAppConfig();
  checkStripeConfig();

  if (allSet) {
    await testWhatsAppConnection();
  }

  showNextSteps();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = { checkEnvVars, checkWhatsAppConfig, checkStripeConfig, testWhatsAppConnection };
