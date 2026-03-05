package claw.policy

default allowed = false

# Deny reasons are accumulated; execution allowed only when none exist.
deny[msg] {
  input.context.read_only_mode
  input.context.mutating_task
  msg := sprintf("read_only_blocks_mutating:%s", [input.type])
}

deny[msg] {
  blocked := input.context.blocked_types[_]
  blocked == input.type
  msg := sprintf("blocked_task_type:%s", [input.type])
}

deny[msg] {
  input.context.policy_disable_destructive_flags
  input.payload.delete == true
  msg := "destructive_flag:delete"
}

deny[msg] {
  input.context.policy_disable_destructive_flags
  input.payload.overwrite_all == true
  msg := "destructive_flag:overwrite_all"
}

deny[msg] {
  input.context.policy_disable_destructive_flags
  input.payload.force_delete == true
  msg := "destructive_flag:force_delete"
}

deny[msg] {
  some field
  field := {"path","source_path","dest_path"}[_]
  p := object.get(input.payload, field, "")
  p != ""
  blocked_prefix(p)
  msg := sprintf("blocked_prefix:%s", [field])
}

deny[msg] {
  some field
  field := {"path","source_path","dest_path"}[_]
  p := object.get(input.payload, field, "")
  p != ""
  not allowed_prefix(p)
  msg := sprintf("outside_allowed_prefixes:%s", [field])
}

allowed {
  count(deny) == 0
}

blocked_prefix(p) {
  startswith(p, "/System")
}
blocked_prefix(p) {
  startswith(p, "/Library")
}
blocked_prefix(p) {
  startswith(p, "/bin")
}
blocked_prefix(p) {
  startswith(p, "/sbin")
}
blocked_prefix(p) {
  startswith(p, "/usr")
}
blocked_prefix(p) {
  startswith(p, "/etc")
}
blocked_prefix(p) {
  startswith(p, "/private/etc")
}
blocked_prefix(p) {
  startswith(p, "/Applications")
}

allowed_prefix(p) {
  pref := input.context.policy_allowed_path_prefixes[_]
  startswith(p, pref)
}

# ─── Action-type gating (high-impact must be part of a plan) ───
high_impact_types := {"migrate", "send_email", "brand_provision", "github_add_repo"}

deny[msg] {
  high_impact_types[input.type]
  not input.plan_id
  msg := sprintf("high_impact_requires_plan:%s", [input.type])
}

deny[msg] {
  high_impact_types[input.type]
  input.plan_id == ""
  msg := sprintf("high_impact_requires_plan:%s", [input.type])
}

# ─── Credit / loyalty action gating (require approval when payload signals it) ───
# When payload.requires_approval is true, payload.approved must be true.
deny[msg] {
  input.payload.requires_approval == true
  input.payload.approved != true
  msg := "action_requires_approval:payload.approved must be true when requires_approval is set"
}
