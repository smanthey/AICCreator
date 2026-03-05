-- Migration 077: Device Registry Hardware Metrics
-- Add CPU load and memory tracking to device_registry for hardware-aware worker gating
-- This prevents scheduling jobs to overloaded workers that would timeout due to thermal/CPU throttling

-- Add CPU load percentage column (0-100)
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS cpu_load_percent NUMERIC(5,2);

-- Add free memory column (in MB)
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS free_mem_mb INTEGER;

-- Add index for efficient hardware gating queries
CREATE INDEX IF NOT EXISTS idx_device_registry_hardware 
  ON device_registry(cpu_load_percent, free_mem_mb) 
  WHERE cpu_load_percent IS NOT NULL AND free_mem_mb IS NOT NULL;

COMMENT ON COLUMN device_registry.cpu_load_percent IS 'CPU load as percentage (0-100), calculated from load_avg / cpu_cores';
COMMENT ON COLUMN device_registry.free_mem_mb IS 'Free memory in MB, used with ram_gb to calculate memory usage percentage';
