// schemas/task.js
// Updated: added PENDING and SKIPPED for task chaining

const VALID_STATES = [
  "CREATED",     // just inserted, no dependencies (legacy compat)
  "PENDING",     // has unmet dependencies — waits for parents to complete
  "QUEUED",      // ready to run — picked up by dispatchPendingTasks()
  "DISPATCHED",  // sent to BullMQ
  "RUNNING",     // worker is executing
  "COMPLETED",   // success
  "FAILED",      // worker error (before retry logic kicks in)
  "RETRY",       // waiting for next_retry_at to pass
  "DEAD_LETTER", // exhausted all retries
  "VERIFIED",    // judge confirmed result
  "DELIVERED",   // final output sent to user
  "SKIPPED",     // dependency failed, this task was never attempted
  "CANCELLED"    // manually killed
];

// Tasks that are "done" — no further processing
const TERMINAL_STATES = [
  "COMPLETED", "DEAD_LETTER", "VERIFIED", "DELIVERED", "SKIPPED", "CANCELLED"
];

// Tasks that count as "failed" for plan tracking
const FAILED_STATES = ["DEAD_LETTER", "SKIPPED", "FAILED"];

function validateStatus(status) {
  if (!VALID_STATES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

function isTerminal(status) {
  return TERMINAL_STATES.includes(status);
}

function isFailed(status) {
  return FAILED_STATES.includes(status);
}

module.exports = {
  VALID_STATES,
  TERMINAL_STATES,
  FAILED_STATES,
  validateStatus,
  isTerminal,
  isFailed
};
