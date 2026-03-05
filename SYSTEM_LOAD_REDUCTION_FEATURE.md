# System Load Reduction Feature

## Overview
Added load reduction functionality to the main dashboard to free up RAM and processing power on the M3 by offloading work to other devices (i7 desktop, satellites). Perfect for intensive work like Blender while keeping the system operational.

## Features

### Dashboard Buttons
- **"💾 Reduce Local Load"** button in the header quick actions
- **"▶️ Resume Local Work"** button appears when load is reduced
- Buttons automatically toggle visibility based on system state

### Functionality

#### Reduce Local Load (`/api/system/reduce-load`)
When clicked, the reduce load button:
1. Stops local PM2 workers (claw-worker) - but keeps dashboard, API, gateway, dispatcher running
2. Marks local device as 'draining' in device_registry (so dispatcher routes work to other devices)
3. Forces garbage collection to free up RAM
4. Saves state to `.load-reduced.json`
5. Returns list of stopped workers

**Result**: Work automatically routes to other devices (i7 desktop, satellites) while M3 is free for Blender work.

#### Resume Local Load (`/api/system/resume-load`)
When clicked, the resume button:
1. Restarts local PM2 workers
2. Marks local device as 'ready' in device_registry (accepts work again)
3. Removes state file
4. Returns list of resumed workers

#### System Status (`/api/system/status`)
- Returns current load reduction state
- Lists all PM2 processes and their status
- Shows device_registry status
- Used on dashboard load to show correct button state

## Usage

1. **To Reduce Load**: Click "💾 Reduce Local Load" button in dashboard header
2. **To Resume**: Click "▶️ Resume Local Work" button (appears after reducing load)
3. **Status Check**: Dashboard automatically checks status on load

**What happens:**
- Local workers stop processing tasks
- New work automatically routes to other devices (i7, satellites)
- Dashboard and API remain accessible
- RAM is freed for your Blender work

## Technical Details

### Files Modified
- `dashboard/index.html` - Added buttons and event handlers
- `scripts/architect-api.js` - Added API endpoints and handlers

### API Endpoints
- `POST /api/system/reduce-load` - Reduce local load (offload to other devices)
- `POST /api/system/resume-load` - Resume local work processing
- `GET /api/system/status` - Get system status

### State Management
- Load reduction state stored in `.load-reduced.json` (gitignored)
- State includes: reduced_at, reduced_by, reason, stopped_workers, hostname

### Process Management
- Uses PM2 to stop/start local workers only
- Automatically detects and manages worker processes (claw-worker)
- Preserves architect-api, gateway, and dispatcher running
- Work routing handled by dispatcher based on device_registry status

## Safety Features

- Architect API server always remains running
- Gateway and dispatcher remain running (work can still be routed)
- Graceful worker shutdown
- State persistence across restarts
- Error handling for missing PM2 or processes
- Work automatically routes to other devices when local workers stop

## Notes

- PM2 must be installed and workers must be managed by PM2
- Device registry must be accessible (for work routing)
- Garbage collection only works if Node.js started with `--expose-gc` flag
- Workers are restarted in the same state they were stopped
- Other devices (i7, satellites) must be online to receive offloaded work
- Dispatcher automatically routes work away from 'draining' devices
