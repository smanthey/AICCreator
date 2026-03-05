# Bot-to-Bot Commerce API

## Overview

Enables autonomous agents to purchase prompts programmatically without human intervention.

## Payment Methods

### 1. API Credits (Recommended for Bots) ✅
- **Status**: Available now
- **Speed**: Instant, zero friction
- **Use case**: Repeat bot customers, pre-purchased credits
- **How it works**: Bots pre-purchase credit bundles, then use credits for instant purchases

### 2. Stripe (USD, USDC, Cards) ✅
- **Status**: Available now
- **Speed**: Requires payment completion
- **Use case**: Human operators, one-time purchases
- **How it works**: Generates payment link, bot completes payment via Stripe Checkout

### 3. Crypto Wallets (Future) 🚧
- **Status**: Planned
- **Speed**: Blockchain confirmation
- **Use case**: Fully autonomous agents with crypto wallets
- **How it works**: Direct wallet-to-wallet payment

## API Endpoints

### Purchase a Prompt

```bash
POST /api/bot/purchase
Authorization: Bearer <API_KEY>  # Optional
Content-Type: application/json

{
  "botId": "bot_123",
  "platform": "discord",
  "protocolType": "agent-intro",
  "context": {
    "botPlatform": "Discord",
    "botPurpose": "trading signals",
    "targetBots": "analytics bots"
  },
  "paymentMethod": "credits"  # "credits" | "stripe" | "crypto"
}
```

**Response (Credits - Instant):**
```json
{
  "success": true,
  "prompt": {
    "content": "...",
    "protocol_type": "agent-intro",
    "generated_at": "2024-01-01T00:00:00.000Z"
  },
  "payment": {
    "method": "credits",
    "charge_id": "credits_123...",
    "paid": true
  },
  "credits": {
    "balance": 9,
    "purchased": 10,
    "spent": 1
  }
}
```

**Response (Stripe - Requires Payment):**
```json
{
  "success": true,
  "requires_payment": true,
  "payment_url": "https://checkout.stripe.com/...",
  "charge_id": "oracle_123...",
  "expires_at": "2024-01-01T00:30:00.000Z",
  "message": "Payment link generated. Complete payment to receive prompt."
}
```

### Check Credit Balance

```bash
GET /api/bot/credits?botId=bot_123
```

**Response:**
```json
{
  "userId": "bot_123",
  "balance": 10,
  "purchased": 10,
  "spent": 0
}
```

### Add Credits (Admin)

```bash
POST /api/bot/credits/add
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "botId": "bot_123",
  "amount": 10
}
```

### List Available Protocols

```bash
GET /api/bot/protocols
```

**Response:**
```json
{
  "protocols": [
    {
      "id": "agent-intro",
      "label": "Agent Introduction",
      "description": "..."
    },
    ...
  ]
}
```

## Usage Examples

### Python Bot Example

```python
import requests

API_URL = "http://localhost:3032"
API_KEY = "your-api-key"  # Optional

# Purchase with credits
response = requests.post(
    f"{API_URL}/api/bot/purchase",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "botId": "my_bot_123",
        "platform": "discord",
        "protocolType": "agent-intro",
        "context": {
            "botPlatform": "Discord",
            "botPurpose": "trading signals",
            "targetBots": "analytics bots"
        },
        "paymentMethod": "credits"
    }
)

if response.json()["success"]:
    prompt = response.json()["prompt"]["content"]
    print(f"Received prompt: {prompt}")
else:
    print(f"Error: {response.json()}")
```

### Node.js Bot Example

```javascript
const fetch = require('node-fetch');

const API_URL = 'http://localhost:3032';
const API_KEY = 'your-api-key'; // Optional

async function purchasePrompt(botId, protocolType, context) {
  const response = await fetch(`${API_URL}/api/bot/purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      botId,
      platform: 'api',
      protocolType,
      context,
      paymentMethod: 'credits',
    }),
  });

  const result = await response.json();
  
  if (result.success && result.prompt) {
    return result.prompt.content;
  } else if (result.requires_payment) {
    // Handle Stripe payment flow
    console.log(`Payment required: ${result.payment_url}`);
    return null;
  } else {
    throw new Error(result.message || 'Purchase failed');
  }
}

// Usage
purchasePrompt('bot_123', 'agent-intro', {
  botPlatform: 'Discord',
  botPurpose: 'trading signals',
  targetBots: 'analytics bots',
}).then(prompt => {
  console.log('Prompt:', prompt);
});
```

## Setup

### 1. Start the API Server

```bash
npm run bot:commerce:api
```

Or with custom port:
```bash
BOT_COMMERCE_API_PORT=3032 node scripts/bot-commerce-api.js
```

### 2. Configure API Key (Optional)

Add to `.env`:
```bash
BOT_COMMERCE_API_KEY=your-secret-api-key
```

### 3. Pre-purchase Credits for Bots

```bash
# Via API
curl -X POST http://localhost:3032/api/bot/credits/add \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot_123", "amount": 10}'

# Or via payment-router CLI
node scripts/payment-router.js credits add bot_123 10
```

## Payment Flow Comparison

### API Credits (Recommended)
1. Bot calls `/api/bot/purchase` with `paymentMethod: "credits"`
2. System checks credit balance
3. If sufficient: deducts credit, generates prompt, returns immediately
4. If insufficient: returns error with current balance

### Stripe Payment
1. Bot calls `/api/bot/purchase` with `paymentMethod: "stripe"`
2. System generates Stripe Checkout session
3. Returns payment URL
4. Bot (or operator) completes payment via Stripe Checkout
5. Webhook confirms payment → prompt delivered via webhook callback

### Crypto Wallets (Future)
1. Bot calls `/api/bot/purchase` with `paymentMethod: "crypto"`
2. System generates crypto payment request
3. Bot signs transaction with wallet
4. Blockchain confirms payment
5. Prompt delivered

## Best Practices for Bot Operators

### 1. Pre-purchase Credits
- Buy credit bundles in advance
- Reduces payment friction
- Enables instant purchases

### 2. Monitor Credit Balance
- Check balance before purchases
- Set up alerts for low balance
- Auto-replenish credits

### 3. Error Handling
- Handle `insufficient_credits` errors
- Retry with Stripe payment if credits exhausted
- Log all purchase attempts

### 4. Rate Limiting
- Implement rate limiting in your bot
- Don't spam the API
- Cache prompts when possible

## Security

### API Key Authentication (Optional)
- Set `BOT_COMMERCE_API_KEY` in `.env`
- Include in `Authorization: Bearer <key>` header
- Required for credit management endpoints

### Bot ID Validation
- Use unique, identifiable bot IDs
- Track bot purchases for analytics
- Monitor for abuse

## Future Enhancements

### Crypto Wallet Integration
- Direct wallet-to-wallet payments
- Support for USDC, USDT, and other stablecoins
- Autonomous agent payments without human intervention

### Subscription Plans
- Monthly credit bundles
- Auto-replenishment
- Volume discounts

### Webhook Delivery
- Real-time prompt delivery via webhooks
- Payment confirmation callbacks
- Status updates

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3032
kill $(lsof -ti :3032)

# Or use different port
BOT_COMMERCE_API_PORT=3033 npm run bot:commerce:api
```

### Insufficient Credits
```bash
# Check balance
curl http://localhost:3032/api/bot/credits?botId=bot_123

# Add credits
curl -X POST http://localhost:3032/api/bot/credits/add \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot_123", "amount": 10}'
```

### API Not Responding
- Check if server is running: `curl http://localhost:3032/api/bot/health`
- Check logs for errors
- Verify environment variables are set

---

**Bot-to-Bot Commerce is ready!** Bots can now purchase prompts programmatically using API credits or Stripe payments. 🚀
