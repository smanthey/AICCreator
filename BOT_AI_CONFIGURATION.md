# Bot AI Configuration

## Overview

**ClawdBots are powered by Ollama (primary) with DeepSeek and Gemini as fallbacks. NO Claude/Anthropic is used.**

## AI Stack

### Primary: Ollama (Local)
- **Default Model**: `deepseek-r1:14b` (configurable via `BOT_MODEL_OLLAMA`)
- **Host**: `http://127.0.0.1:11434` (configurable via `OLLAMA_HOST`)
- **Cost**: $0 (local inference)
- **Speed**: Fast (local)
- **Use Case**: All bot AI operations (learning, optimization, strategy)

### Fallback 1: DeepSeek (Cloud)
- **Default Model**: `deepseek-chat`
- **API Key**: `DEEPSEEK_API_KEY`
- **Cost**: Very low ($0.00014/$0.00028 per 1k tokens)
- **Use Case**: When Ollama is unavailable

### Fallback 2: Gemini (Cloud)
- **Default Model**: `gemini-2.0-flash`
- **API Key**: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- **Cost**: Very low ($0.000075/$0.0003 per 1k tokens)
- **Use Case**: When Ollama and DeepSeek are unavailable

## Configuration

### Environment Variables

```bash
# Ollama (required for primary)
OLLAMA_HOST=http://127.0.0.1:11434
BOT_MODEL_OLLAMA=deepseek-r1:14b

# DeepSeek (optional fallback)
DEEPSEEK_API_KEY=your_key_here

# Gemini (optional fallback)
GEMINI_API_KEY=your_key_here
# OR
GOOGLE_API_KEY=your_key_here
```

### Model Selection

The bot AI helper automatically:
1. Tries Ollama first (local, free, fast)
2. Falls back to DeepSeek if Ollama fails
3. Falls back to Gemini if DeepSeek fails
4. Throws error only if all providers fail

## Usage in Bot Scripts

All bot scripts use `bot-ai-helper.js`:

```javascript
const { botAICall, extractJSON } = require("./bot-ai-helper");

// Simple call
const result = await botAICall("Your prompt here", null, {
  max_tokens: 2000,
  temperature: 0.7,
});

// With system prompt
const result = await botAICall(
  "User message",
  "You are a helpful assistant",
  { temperature: 0.8 }
);

// Extract JSON from response
const json = extractJSON(result.text);
```

## Files Updated

All bot scripts now use Ollama/DeepSeek/Gemini instead of Claude:

- ✅ `scripts/bot-ai-helper.js` - New AI helper (Ollama/DeepSeek/Gemini)
- ✅ `scripts/bot-autonomous-agent.js` - Uses bot-ai-helper
- ✅ `scripts/bot-learning-system.js` - Uses bot-ai-helper
- ✅ `scripts/bot-message-optimizer.js` - Uses bot-ai-helper
- ✅ `trigger-tasks/bot-collection-autonomous.ts` - Uses bot-ai-helper

## Why This Configuration?

1. **Cost**: Ollama is free (local), DeepSeek/Gemini are very cheap
2. **Speed**: Local Ollama is fastest
3. **Privacy**: Local inference keeps data private
4. **Reliability**: Multiple fallbacks ensure availability
5. **No Claude dependency**: Reduces costs and API dependencies

## Testing

```bash
# Test Ollama connection
curl http://127.0.0.1:11434/api/tags

# Test bot AI helper
node -e "const {botAICall} = require('./scripts/bot-ai-helper'); botAICall('Hello').then(r => console.log(r.text))"
```

## Troubleshooting

### Ollama Not Running

```bash
# Start Ollama
pm2 start ecosystem.background.config.js --only claw-ollama
# OR
ollama serve
```

### Models Not Available

```bash
# Pull required models
ollama pull deepseek-r1:14b
ollama pull deepseek-v3
ollama pull qwen3:14b
```

### Fallback to Cloud

If Ollama fails, the system automatically uses DeepSeek or Gemini. No action needed.

## Model Recommendations

For bot operations:
- **Strategy/Planning**: `deepseek-r1:14b` (reasoning)
- **Message Generation**: `deepseek-v3` or `qwen3:14b` (fast, good quality)
- **Analysis**: `deepseek-r1:14b` (best reasoning)

Configure via `BOT_MODEL_OLLAMA` environment variable.
