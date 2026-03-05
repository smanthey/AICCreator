#!/usr/bin/env node
"use strict";

/**
 * bot-message-optimizer.js — Message A/B Testing and Optimization
 * 
 * Creates and tests multiple message variations to find what works best.
 * Continuously optimizes based on conversion data.
 */

require("dotenv").config({ override: true });

const { getBestMessages, saveInsight } = require("./bot-learning-system");
const { botAICall, extractJSON } = require("./bot-ai-helper");

// ─── Message Templates ─────────────────────────────────────────────────────

const MESSAGE_TEMPLATES = {
  direct: {
    name: "Direct Value Proposition",
    variants: [
      "Hi! I'm building a bot communication platform. Would you be interested in connecting your bot to communicate with other AI agents?",
      "Hey! I noticed your bot. Would you like to join a network where bots can discover and communicate with each other?",
      "Hello! I'm creating a bot-to-bot communication system. Interested in early access?",
    ],
  },
  value: {
    name: "Value-Focused",
    variants: [
      "Hi! Your bot could earn credits by helping other bots. Interested?",
      "Hey! I can help your bot monetize through our bot communication network. Want to learn more?",
      "Hello! Your bot could generate revenue by connecting with other bots. Interested?",
    ],
  },
  community: {
    name: "Community-Focused",
    variants: [
      "Hi! Join a growing network of AI bots that can discover and collaborate with each other.",
      "Hey! Be part of the agent internet - a network where bots communicate and work together.",
      "Hello! Join other bots in a discovery and communication platform. Interested?",
    ],
  },
  technical: {
    name: "Technical",
    variants: [
      "Hi! I'm building a bot registry and communication protocol. Your bot could integrate via API. Interested?",
      "Hey! I've created a standardized bot-to-bot communication protocol. Want to integrate?",
      "Hello! I built a bot discovery platform with REST API. Interested in connecting?",
    ],
  },
  personal: {
    name: "Personal",
    variants: [
      "Hi! I'm working on something cool - a way for bots to find and talk to each other. Want to try it?",
      "Hey! I built a platform where bots can discover each other. Thought you might find it interesting!",
      "Hello! I created a bot communication system. Would love your feedback if you're interested!",
    ],
  },
};

// ─── Generate Message Variations ──────────────────────────────────────────

async function generateMessageVariations(baseMessage, count = 5) {
  const prompt = `Generate ${count} variations of this bot outreach message. Each should have a different tone/approach but same goal:

"${baseMessage}"

Return as JSON array of strings.`;
  
  try {
    const result = await botAICall(prompt, null, {
      max_tokens: 1000,
      temperature: 0.8,
    });
    
    const json = extractJSON(result.text);
    if (json && Array.isArray(json)) {
      return json;
    }
  } catch (err) {
    console.warn("[optimizer] AI generation failed, using templates:", err.message);
  }
  
  return generateTemplateVariations();
}

function generateTemplateVariations() {
  const allVariants = [];
  for (const template of Object.values(MESSAGE_TEMPLATES)) {
    allVariants.push(...template.variants);
  }
  return allVariants;
}

// ─── Get Optimized Message ────────────────────────────────────────────────

async function getOptimizedMessage(platform, botContext = {}) {
  // Get best performing messages for this platform
  const bestMessages = await getBestMessages(platform, 10);
  
  if (bestMessages.length > 0) {
    // Use best performing variant
    const best = bestMessages[0];
    return {
      variant: best.message_variant,
      content: await getMessageContent(best.message_variant),
      confidence: parseFloat(best.conversion_rate),
      source: "optimized",
    };
  }
  
  // Fallback to template-based selection
  const templates = Object.values(MESSAGE_TEMPLATES);
  // Deterministic selection based on performance (not random)
  // Prefer templates with higher conversion rates
  const sortedTemplates = templates.sort((a, b) => {
    const aRate = parseFloat(a.avg_conversion_rate || 0);
    const bRate = parseFloat(b.avg_conversion_rate || 0);
    return bRate - aRate; // Descending order
  });
  
  // Select top performer, but occasionally try second-best for A/B testing
  const selectionIndex = templates.length > 1 && (Date.now() % 10 < 2) ? 1 : 0;
  const selectedTemplate = sortedTemplates[selectionIndex];
  
  // Select best variant from template
  const sortedVariants = selectedTemplate.variants.sort((a, b) => {
    const aRate = parseFloat(a.conversion_rate || 0);
    const bRate = parseFloat(b.conversion_rate || 0);
    return bRate - aRate;
  });
  const variant = sortedVariants[0] || selectedTemplate.variants[0];
  
  return {
    variant: selectedTemplate.name,
    content: variant,
    confidence: 0.1, // Low confidence for untested
    source: "template",
  };
}

async function getMessageContent(variantName) {
  // Try to get actual message content from database
  // For now, return a template-based message
  for (const template of Object.values(MESSAGE_TEMPLATES)) {
    if (template.name.toLowerCase().includes(variantName.toLowerCase())) {
      return template.variants[0];
    }
  }
  
  return MESSAGE_TEMPLATES.direct.variants[0];
}

// ─── Test New Variants ─────────────────────────────────────────────────────

async function suggestNewVariantsToTest(currentBest, count = 3) {
  const prompt = `Based on this best-performing message, suggest ${count} new variations to test:

"${currentBest}"

Make them different in approach (tone, value prop, length) but same goal.
Return as JSON array of strings.`;
  
  try {
    const result = await botAICall(prompt, null, {
      max_tokens: 1000,
      temperature: 0.8,
    });
    
    const json = extractJSON(result.text);
    if (json && Array.isArray(json)) {
      return json;
    }
  } catch (err) {
    console.warn("[optimizer] AI suggestion failed:", err.message);
  }
  
  return generateTemplateVariations().slice(0, count);
}

// ─── Optimize Message for Bot ────────────────────────────────────────────

async function optimizeMessageForBot(botId, botMetadata) {
  // Analyze bot characteristics
  const platform = botMetadata.platform || "unknown";
  const hasReputation = botMetadata.notes?.reputation > 0 || botMetadata.notes?.karma > 0;
  const isVerified = botMetadata.notes?.verified || false;
  
  // Get optimized message
  const optimized = await getOptimizedMessage(platform, botMetadata);
  
  // Personalize based on bot characteristics
  let message = optimized.content;
  
  if (hasReputation) {
    message = message.replace(/Hi!/, `Hi! I noticed your bot has great reputation (${botMetadata.notes?.reputation || botMetadata.notes?.karma} karma).`);
  }
  
  if (isVerified) {
    message = message.replace(/Hi!/, `Hi! I see your bot is verified.`);
  }
  
  return {
    ...optimized,
    content: message,
    personalized: true,
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "optimize";
  
  if (command === "optimize") {
    const platform = args[1] || "discord";
    const optimized = await getOptimizedMessage(platform);
    console.log("Optimized Message:");
    console.log(`Variant: ${optimized.variant}`);
    console.log(`Confidence: ${(optimized.confidence * 100).toFixed(1)}%`);
    console.log(`Content: ${optimized.content}`);
  } else if (command === "generate") {
    const base = args[1] || "Hi! Interested in bot communication?";
    const count = args[2] ? parseInt(args[2]) : 5;
    const variants = await generateMessageVariations(base, count);
    console.log("Generated Variants:");
    variants.forEach((v, i) => {
      console.log(`${i + 1}. ${v}`);
    });
  } else if (command === "suggest") {
    const best = args[1] || "Hi! Interested in bot communication?";
    const suggestions = await suggestNewVariantsToTest(best, 3);
    console.log("Suggested New Variants to Test:");
    suggestions.forEach((v, i) => {
      console.log(`${i + 1}. ${v}`);
    });
  } else {
    console.log(`
bot-message-optimizer.js — Message A/B Testing and Optimization

Commands:
  node scripts/bot-message-optimizer.js optimize [platform]  # Get optimized message
  node scripts/bot-message-optimizer.js generate [base] [n]  # Generate variations
  node scripts/bot-message-optimizer.js suggest [best]        # Suggest new tests
    `);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  getOptimizedMessage,
  generateMessageVariations,
  suggestNewVariantsToTest,
  optimizeMessageForBot,
  MESSAGE_TEMPLATES,
};
