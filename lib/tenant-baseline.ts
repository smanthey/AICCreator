export function requireOrganizationId(input: { organization_id?: string | null; org_id?: string | null; tenant_id?: string | null }) {
  const organization_id = input.organization_id || input.org_id || input.tenant_id || null;
  if (!organization_id) {
    throw new Error("organization_id required");
  }
  return organization_id;
}

export function requireRole(role: string, allowed: string[] = ["owner", "admin"]) {
  if (!allowed.includes(role)) {
    throw new Error("rbac violation");
  }
  return true;
}
