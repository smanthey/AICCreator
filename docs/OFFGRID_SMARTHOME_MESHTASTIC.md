# Off-Grid Smart Home: Meshtastic + OpenClaw + Home Assistant + Apple Home

This setup keeps core home control running during internet outages.

## Architecture

1. T-Echo (Meshtastic radio) receives/sends text commands over LoRa mesh.
2. `claw-offgrid-meshtastic-bridge` runs 24/7 on Mac mini and translates commands.
3. Home Assistant executes local device actions (lights, temp/humidity reads, presence).
4. Local Ollama handles `/ask` prompts without internet.
5. Architect API serves dashboard at `/offgrid-home`.

## Research-backed integration notes

- Meshtastic Python API + interfaces (serial/ble/tcp):
  - https://meshtastic.org/docs/software/python/cli/
  - https://meshtastic.org/docs/software/python/python-installation/
- Home Assistant REST API and auth:
  - https://developers.home-assistant.io/docs/api/rest/
  - https://developers.home-assistant.io/docs/auth_api/
- Home Assistant + Meshtastic integration references:
  - https://www.home-assistant.io/integrations/meshtastic/
  - https://github.com/home-assistant/core/tree/dev/homeassistant/components/meshtastic
- Hue without Hue hub (Apple Home fallback):
  - Hue Bridge is normally required for native Hue HomeKit.
  - Alternative: pair bulbs to Home Assistant (ZHA/Zigbee2MQTT) and expose through HA HomeKit Bridge.
  - HomeKit Bridge docs: https://www.home-assistant.io/integrations/homekit/

## Implemented files

- Bridge daemon: `scripts/offgrid-meshtastic-bridge.py`
- Control module: `control/offgrid-home.js`
- Dashboard: `dashboard/offgrid-home.html`
- API endpoints: `scripts/architect-api.js`
- PM2 app: `ecosystem.background.config.js` (`claw-offgrid-meshtastic-bridge`)

## API endpoints

- `GET /api/offgrid/status` - Bridge status and recent events
- `GET /api/offgrid/snapshot` - Current state of configured entities
- `GET /api/offgrid/lights/discover` - Discover all light entities from Home Assistant
- `POST /api/offgrid/lights/flicker-test` - Flicker bulbs to identify them (like Hue app)
  - Body: `{ "entity_ids": ["light.living_room", "light.kitchen"], "duration_ms": 500, "cycles": 3 }`
- `POST /api/offgrid/mesh/send` body: `{ "text": "lights on", "to": "broadcast" }`
- `POST /api/offgrid/light` body: `{ "entity_id": "light.living_room", "on": true, "brightness_pct": 80 }`
- `POST /api/offgrid/service` body: `{ "domain": "switch", "service": "turn_on", "service_data": {"entity_id":"switch.foo"} }`
- `GET /offgrid-home` dashboard

## Setup steps

1. Install Python deps on Mac mini:

```bash
python3 -m pip install --upgrade pip
python3 -m pip install meshtastic pypubsub
```

2. Configure `.env` values:

- `MESHTASTIC_BRIDGE_MODE=serial` (or `ble`/`tcp`)
- `MESHTASTIC_DEVICE=/dev/tty.usbmodem...` (for serial)
- `HOME_ASSISTANT_URL=http://homeassistant.local:8123`
- `HOME_ASSISTANT_TOKEN=<long-lived-token>`
- `OFFGRID_LIGHT_ENTITIES`, `OFFGRID_SENSOR_ENTITIES`, `OFFGRID_PRESENCE_ENTITIES`

3. Start services:

```bash
cd $HOME/claw-architect
npm run pm2:background:reload
pm2 restart claw-architect-api claw-offgrid-meshtastic-bridge --update-env
pm2 save
```

4. Verify:

```bash
npm run offgrid:status
npm run offgrid:snapshot
```

5. Open dashboard:

- `http://127.0.0.1:4051/offgrid-home`

## Commands over mesh

- `lights on`
- `lights off`
- `status`
- `temp`
- `humidity`
- `who home`
- `/ask summarize current home status`

## Light Discovery & Connection Testing

### Flicker Test (Identify Bulbs)

Like the Hue app's "identify" feature, the flicker test helps you visually identify which bulb corresponds to which entity ID:

1. Click "🔍 Discover All Lights" in the dashboard to find all light entities
2. Click "💡 Flicker Test (Identify)" to make each bulb flicker sequentially
3. Watch the bulbs - each will turn on/off 3 times in sequence
4. Match the flickering bulb to the entity ID shown in the dashboard

This is especially useful when:
- Setting up new bulbs
- Troubleshooting connection issues
- Identifying which entity ID controls which physical bulb
- Replacing Hue Bridge with Home Assistant

### Automatic Discovery

The system automatically discovers all `light.*` entities from Home Assistant, showing:
- Entity ID (e.g., `light.living_room`)
- Friendly name (if set in Home Assistant)
- Current state (on/off)
- Supported features (brightness, color, etc.)

## Apple Home Integration (Robust Hue Replacement)

This system provides a **robust replacement for Hue's system** that works seamlessly with Apple Home:

### Setup Steps

1. **Pair Hue bulbs to Home Assistant** (no Hue Bridge needed):
   - Use ZHA (Zigbee Home Automation) or Zigbee2MQTT integration
   - Put bulbs in pairing mode (power cycle or use Hue app if still connected)
   - Add device in Home Assistant → Settings → Devices & Services → Add Integration → ZHA/Zigbee2MQTT

2. **Expose to Apple Home via HomeKit Bridge**:
   - In Home Assistant: Settings → Devices & Services → Add Integration → HomeKit Bridge
   - Select which entities to expose (lights, sensors, etc.)
   - Home Assistant will generate a QR code and pairing code

3. **Add to iPhone Home app**:
   - Open Home app → Add Accessory → Scan QR code (or enter pairing code)
   - All exposed entities will appear in Apple Home
   - Create scenes and automations in Apple Home as normal

4. **Use connection test to identify bulbs**:
   - Run flicker test from dashboard to visually match entity IDs to physical bulbs
   - Update friendly names in Home Assistant for easier identification

### Advantages Over Hue Bridge

- **No dependency on Hue Bridge** - works even if bridge fails
- **Local control only** - no cloud required, works offline
- **Better integration** - works with any Zigbee device, not just Hue
- **More reliable** - Home Assistant is more stable than Hue Bridge
- **Apple Home compatible** - full HomeKit support via HomeKit Bridge
- **Off-grid capable** - works during internet outages

### Troubleshooting

- **Bulbs not discovered**: Check Zigbee coordinator is working in Home Assistant
- **Flicker test fails**: Verify entity IDs are correct and bulbs are online
- **Apple Home not showing lights**: Ensure HomeKit Bridge integration is active and entities are exposed

## Outage behavior

- LoRa mesh commands still work.
- Home Assistant local LAN actions still work.
- Ollama local `/ask` responses still work.
- Internet-only services (cloud relays, remote APIs) are not required for core flows.
