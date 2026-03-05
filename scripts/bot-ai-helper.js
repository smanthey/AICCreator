#!/usr/bin/env node
"use strict";

/**
 * bot-ai-helper.js
 * 
 * AI helper for bot scripts using Ollama (primary), DeepSeek, and Gemini.
 * NO Claude/Anthropic - bots are powered by local Ollama with cloud fallbacks.
 */

require("dotenv").config({ override: true });

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Default models (Ollama first, then cloud)
const DEFAULT_MODEL_OLLAMA = process.env.BOT_MODEL_OLLAMA || "deepseek-r1:8b";
const DEFAULT_MODEL_DEEPSEEK = "deepseek-chat";
const DEFAULT_MODEL_GEMINI = "gemini-2.0-flash";

// ─── Call Ollama ───────────────────────────────────────────────────────────

async function callOllama(prompt, systemPrompt = null, model = null, options = {}) {
  const modelName = model || DEFAULT_MODEL_OLLAMA;
  const host = OLLAMA_HOST.startsWith("http") ? OLLAMA_HOST : `http://${OLLAMA_HOST}`;
  const endpoint = `${host}/api/chat`;
  
  const body = {
    model: modelName,
    stream: false,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    options: {
      temperature: options.temperature ?? 0.7,
      ...(options.max_tokens ? { num_predict: options.max_tokens } : {}),
    },
  };
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout_ms || 60000),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama ${response.status}: ${error.slice(0, 200)}`);
    }
    
    const data = await response.json();
    return {
      text: data?.message?.content || data?.response || "",
      model: modelName,
      provider: "ollama",
      tokens_in: data?.prompt_eval_count || 0,
      tokens_out: data?.eval_count || 0,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Ollama timeout");
    }
    throw err;
  }
}

// ─── Call DeepSeek ────────────────────────────────────────────────────────

async function callDeepSeek(prompt, systemPrompt = null, model = null, options = {}) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not set");
  }
  
  const modelName = model || DEFAULT_MODEL_DEEPSEEK;
  const endpoint = "https://api.deepseek.com/v1/chat/completions";
  
  const body = {
    model: modelName,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens || 2000,
  };
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout_ms || 60000),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DeepSeek ${response.status}: ${error?.error?.message || JSON.stringify(error)}`);
    }
    
    const data = await response.json();
    return {
      text: data?.choices?.[0]?.message?.content || "",
      model: modelName,
      provider: "deepseek",
      tokens_in: data?.usage?.prompt_tokens || 0,
      tokens_out: data?.usage?.completion_tokens || 0,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("DeepSeek timeout");
    }
    throw err;
  }
}

// ─── Call Gemini ───────────────────────────────────────────────────────────

async function callGemini(prompt, systemPrompt = null, model = null, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not set");
  }
  
  const modelName = model || DEFAULT_MODEL_GEMINI;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  
  const contents = [];
  if (systemPrompt) {
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });
  
  const body = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.max_tokens || 2000,
    },
  };
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout_ms || 60000),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gemini ${response.status}: ${error?.error?.message || JSON.stringify(error)}`);
    }
    
    const data = await response.json();
    return {
      text: data?.candidates?.[0]?.content?.parts?.[0]?.text || "",
      model: modelName,
      provider: "gemini",
      tokens_in: data?.usageMetadata?.promptTokenCount || 0,
      tokens_out: data?.usageMetadata?.candidatesTokenCount || 0,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Gemini timeout");
    }
    throw err;
  }
}

// ─── Bot AI Call (with fallback chain) ────────────────────────────────────

/**
 * Call AI with fallback: Ollama → DeepSeek → Gemini
 * Bots use Ollama primarily, with cloud fallbacks.
 */
async function botAICall(prompt, systemPrompt = null, options = {}) {
  const fallbackChain = options.fallback_chain || ["ollama", "deepseek", "gemini"];
  
  for (const provider of fallbackChain) {
    try {
      if (provider === "ollama") {
        return await callOllama(prompt, systemPrompt, options.model, options);
      } else if (provider === "deepseek") {
        return await callDeepSeek(prompt, systemPrompt, options.model, options);
      } else if (provider === "gemini") {
        return await callGemini(prompt, systemPrompt, options.model, options);
      }
    } catch (err) {
      console.warn(`[bot-ai] ${provider} failed:`, err.message);
      // Continue to next provider
      if (fallbackChain.indexOf(provider) === fallbackChain.length - 1) {
        // Last provider failed
        throw new Error(`All AI providers failed. Last error: ${err.message}`);
      }
    }
  }
  
  throw new Error("No AI providers available");
}

// ─── Extract JSON from Response ───────────────────────────────────────────

function extractJSON(text) {
  // Try to find JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }
  
  // Try to find JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }
  
  return null;
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  botAICall,
  callOllama,
  callDeepSeek,
  callGemini,
  extractJSON,
  DEFAULT_MODEL_OLLAMA,
  DEFAULT_MODEL_DEEPSEEK,
  DEFAULT_MODEL_GEMINI,
};
