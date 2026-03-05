#!/usr/bin/env python3
"""
Meshtastic -> Home Assistant off-grid bridge.
- Receives mesh text commands
- Executes local Home Assistant actions
- Optionally uses local Ollama for /ask prompts
- Sends response back over mesh
- Processes outbound command queue from dashboard/API
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "offgrid-home"
EVENTS_FILE = Path(os.getenv("MESHTASTIC_EVENTS_FILE", str(DATA_DIR / "meshtastic-events.jsonl")))
COMMANDS_FILE = Path(os.getenv("MESHTASTIC_COMMANDS_FILE", str(DATA_DIR / "meshtastic-commands.jsonl")))
HEARTBEAT_FILE = Path(os.getenv("MESHTASTIC_HEARTBEAT_FILE", str(DATA_DIR / "meshtastic-heartbeat.json")))
STATE_FILE = DATA_DIR / "meshtastic-bridge-state.json"

HA_URL = os.getenv("HOME_ASSISTANT_URL", "").rstrip("/")
HA_TOKEN = os.getenv("HOME_ASSISTANT_TOKEN", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OFFGRID_AI_MODEL", os.getenv("OLLAMA_MODEL_FAST", "llama3.1:8b"))

LIGHT_ENTITIES = [x.strip() for x in os.getenv("OFFGRID_LIGHT_ENTITIES", "").split(",") if x.strip()]
SENSOR_ENTITIES = [x.strip() for x in os.getenv("OFFGRID_SENSOR_ENTITIES", "").split(",") if x.strip()]
PRESENCE_ENTITIES = [x.strip() for x in os.getenv("OFFGRID_PRESENCE_ENTITIES", "").split(",") if x.strip()]

MODE = os.getenv("MESHTASTIC_BRIDGE_MODE", "serial").strip().lower()  # serial|ble|tcp|simulate
SERIAL_PORT = os.getenv("MESHTASTIC_DEVICE", "")
BLE_ADDR = os.getenv("MESHTASTIC_BLE_ADDRESS", "")
TCP_HOST = os.getenv("MESHTASTIC_TCP_HOST", "")
TCP_PORT = int(os.getenv("MESHTASTIC_TCP_PORT", "4403"))
POLL_SECONDS = max(1, int(os.getenv("MESHTASTIC_BRIDGE_POLL_SEC", "2")))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs():
    for p in (EVENTS_FILE.parent, COMMANDS_FILE.parent, HEARTBEAT_FILE.parent, STATE_FILE.parent):
        p.mkdir(parents=True, exist_ok=True)


def append_jsonl(path: Path, row: dict):
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=True) + "\n")


def read_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"last_command_offset": 0}


def write_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def write_heartbeat(connected: bool, info: dict):
    hb = {
        "ts": now_iso(),
        "connected": connected,
        "mode": MODE,
        "serial_port": SERIAL_PORT or None,
        "ble_address": BLE_ADDR or None,
        "tcp": f"{TCP_HOST}:{TCP_PORT}" if TCP_HOST else None,
        "info": info,
    }
    HEARTBEAT_FILE.write_text(json.dumps(hb, indent=2), encoding="utf-8")


def http_json(url: str, method="GET", payload=None, headers=None, timeout=8):
    b = None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    if payload is not None:
        b = json.dumps(payload).encode("utf-8")
    req = request.Request(url=url, method=method, data=b, headers=hdrs)
    try:
        with request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8")
            if not body:
                return True, None, res.status
            try:
                return True, json.loads(body), res.status
            except Exception:
                return True, body, res.status
    except error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
        except Exception:
            body = str(e)
        return False, body, e.code
    except Exception as e:
        return False, str(e), 0


def ha_request(pathname: str, method="GET", payload=None):
    if not HA_URL or not HA_TOKEN:
        return False, "home_assistant_not_configured", 0
    headers = {"Authorization": f"Bearer {HA_TOKEN}"}
    return http_json(f"{HA_URL}{pathname}", method=method, payload=payload, headers=headers)


def ha_get_state(entity_id: str):
    ok, data, status = ha_request(f"/api/states/{entity_id}")
    if not ok:
        return {"entity_id": entity_id, "ok": False, "error": str(data), "status": status}
    return {
        "entity_id": entity_id,
        "ok": True,
        "state": data.get("state") if isinstance(data, dict) else None,
        "attributes": data.get("attributes", {}) if isinstance(data, dict) else {},
    }


def ha_light(entity_id: str, turn_on: bool, brightness_pct=None):
    service = "turn_on" if turn_on else "turn_off"
    payload = {"entity_id": entity_id}
    if turn_on and brightness_pct is not None:
        payload["brightness_pct"] = max(1, min(100, int(brightness_pct)))
    return ha_request(f"/api/services/light/{service}", method="POST", payload=payload)


def summarize_home():
    temp_parts = []
    for s in SENSOR_ENTITIES[:8]:
        row = ha_get_state(s)
        if row.get("ok"):
            unit = row.get("attributes", {}).get("unit_of_measurement", "")
            temp_parts.append(f"{s}={row.get('state')}{unit}")
    home_people = []
    away_people = []
    for p in PRESENCE_ENTITIES[:10]:
        row = ha_get_state(p)
        if row.get("ok"):
            if str(row.get("state", "")).lower() == "home":
                home_people.append(p.split(".")[-1])
            else:
                away_people.append(p.split(".")[-1])
    return {
        "sensors": temp_parts,
        "home": home_people,
        "away": away_people,
    }


def ollama_reply(prompt: str):
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2},
    }
    ok, data, status = http_json(f"{OLLAMA_HOST}/api/generate", method="POST", payload=payload, timeout=20)
    if not ok:
        return f"AI unavailable ({status}): {str(data)[:80]}"
    if isinstance(data, dict):
        return str(data.get("response", "")).strip()[:380] or "No response"
    return str(data)[:380]


def parse_light_target(text_lower: str):
    if not LIGHT_ENTITIES:
        return []
    if "all" in text_lower:
        return LIGHT_ENTITIES
    matched = []
    for ent in LIGHT_ENTITIES:
        alias = ent.split(".")[-1].replace("_", " ").lower()
        if alias in text_lower:
            matched.append(ent)
    return matched or [LIGHT_ENTITIES[0]]


def route_command(text: str):
    t = (text or "").strip()
    l = t.lower()

    if not t:
        return "No command text received."

    if l.startswith("/ask "):
        q = t[5:].strip()
        home = summarize_home()
        prompt = (
            "You are an off-grid home assistant. Answer briefly and actionably.\n"
            f"Home state: sensors={home['sensors']} home={home['home']} away={home['away']}\n"
            f"User question: {q}"
        )
        return ollama_reply(prompt)

    if "help" in l:
        return "Commands: lights on/off [room|all], status, temp, humidity, who home, /ask <question>."

    if "status" in l:
        home = summarize_home()
        return f"Status: home={','.join(home['home']) or 'none'} away={','.join(home['away']) or 'none'} sensors={'; '.join(home['sensors']) or 'none'}"

    if "who" in l and "home" in l:
        home = summarize_home()
        return f"Home now: {', '.join(home['home']) if home['home'] else 'nobody'}"

    if "temp" in l or "humidity" in l:
        home = summarize_home()
        return f"Sensors: {'; '.join(home['sensors']) if home['sensors'] else 'none configured'}"

    if "light" in l or "lights" in l:
        targets = parse_light_target(l)
        if not targets:
            return "No light entities configured. Set OFFGRID_LIGHT_ENTITIES."

        turn_on = any(x in l for x in [" on", " turn on", "lights on"]) and "off" not in l
        turn_off = any(x in l for x in [" off", " turn off", "lights off"])
        if not turn_on and not turn_off:
            return "Specify lights on or lights off."

        ok_count = 0
        for ent in targets:
            ok, _, _ = ha_light(ent, turn_on=turn_on)
            if ok:
                ok_count += 1
        action = "on" if turn_on else "off"
        return f"Lights {action}: {ok_count}/{len(targets)}"

    return "Command not recognized. Say 'help' for examples."


def send_mesh_text(interface, text, destination=None):
    if not interface:
        return False
    try:
        if destination:
            interface.sendText(text, destinationId=destination)
        else:
            interface.sendText(text)
        return True
    except TypeError:
        try:
            interface.sendText(text)
            return True
        except Exception:
            return False
    except Exception:
        return False


def extract_packet_text(packet):
    if not isinstance(packet, dict):
        return ""
    d = packet.get("decoded", {}) if isinstance(packet.get("decoded"), dict) else {}
    text = d.get("text") or packet.get("text")
    if text:
        return str(text)
    payload = d.get("payload")
    if isinstance(payload, (bytes, bytearray)):
        try:
            return payload.decode("utf-8", errors="ignore")
        except Exception:
            return ""
    return ""


def process_outbound_queue(interface):
    state = read_state()
    offset = int(state.get("last_command_offset", 0))
    try:
        raw = COMMANDS_FILE.read_text(encoding="utf-8")
    except Exception:
        return

    lines = raw.splitlines()
    if offset > len(lines):
        offset = 0
    new_lines = lines[offset:]
    for line in new_lines:
        try:
            row = json.loads(line)
        except Exception:
            continue
        if row.get("direction") != "outbound":
            continue
        if row.get("sent_at") or row.get("error"):
            continue
        text = str(row.get("text", "")).strip()
        if not text:
            continue
        sent = send_mesh_text(interface, text, destination=row.get("to") if row.get("to") not in ("", "broadcast") else None)
        event = {
            "id": row.get("id") or f"cmd-{int(time.time()*1000)}",
            "direction": "outbound",
            "kind": "text",
            "text": text,
            "from": "offgrid-bridge",
            "to": row.get("to", "broadcast"),
            "ts": now_iso(),
            "raw": {"queue": "commands", "sent": sent},
            "sent_at": now_iso() if sent else None,
            "error": None if sent else "send_failed",
        }
        append_jsonl(EVENTS_FILE, event)

    state["last_command_offset"] = len(lines)
    write_state(state)


def connect_interface():
    if MODE == "simulate":
        return None, {"connected": True, "note": "simulate mode"}

    try:
        from meshtastic import serial_interface, tcp_interface, ble_interface  # type: ignore
        from pubsub import pub  # type: ignore
    except Exception as e:
        return None, {"connected": False, "error": f"meshtastic_import_failed:{e}"}

    iface = None
    try:
        if MODE == "ble":
            if not BLE_ADDR:
                return None, {"connected": False, "error": "MESHTASTIC_BLE_ADDRESS missing"}
            iface = ble_interface.BLEInterface(BLE_ADDR)
        elif MODE == "tcp":
            host = TCP_HOST or "127.0.0.1"
            iface = tcp_interface.TCPInterface(hostname=host, portNumber=TCP_PORT)
        else:
            if SERIAL_PORT:
                iface = serial_interface.SerialInterface(devPath=SERIAL_PORT)
            else:
                iface = serial_interface.SerialInterface()

        def on_receive(packet=None, interface=None):
            try:
                pkt = packet or {}
                text = extract_packet_text(pkt)
                from_id = pkt.get("fromId") or pkt.get("from")
                if not text:
                    return
                append_jsonl(EVENTS_FILE, {
                    "id": f"in-{int(time.time()*1000)}",
                    "direction": "inbound",
                    "kind": "text",
                    "text": text,
                    "from": from_id,
                    "to": "local",
                    "channel": pkt.get("channel", 0),
                    "ts": now_iso(),
                    "raw": pkt,
                })
                resp = route_command(text)
                send_mesh_text(iface, resp, destination=from_id)
                append_jsonl(EVENTS_FILE, {
                    "id": f"out-{int(time.time()*1000)}",
                    "direction": "outbound",
                    "kind": "text",
                    "text": resp,
                    "from": "offgrid-bridge",
                    "to": from_id or "broadcast",
                    "ts": now_iso(),
                    "raw": {"source": "auto_reply"},
                })
            except Exception:
                append_jsonl(EVENTS_FILE, {
                    "id": f"err-{int(time.time()*1000)}",
                    "direction": "internal",
                    "kind": "error",
                    "text": "receive_handler_error",
                    "ts": now_iso(),
                    "raw": {"trace": traceback.format_exc()[:1200]},
                })

        pub.subscribe(on_receive, "meshtastic.receive")
        return iface, {"connected": True, "mode": MODE}
    except Exception as e:
        return None, {"connected": False, "error": str(e)}


def main():
    ensure_dirs()
    iface, info = connect_interface()
    connected = bool(info.get("connected"))
    write_heartbeat(connected, info)
    print(f"[offgrid-meshtastic-bridge] mode={MODE} connected={connected} info={info}")

    while True:
        try:
            process_outbound_queue(iface)
            write_heartbeat(connected, info)
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            break
        except Exception:
            append_jsonl(EVENTS_FILE, {
                "id": f"loop-err-{int(time.time()*1000)}",
                "direction": "internal",
                "kind": "error",
                "text": "loop_error",
                "ts": now_iso(),
                "raw": {"trace": traceback.format_exc()[:1200]},
            })
            time.sleep(2)


if __name__ == "__main__":
    main()
