# Runbook: tenant onboarding

**Goal:** a new customer can sign in to a branded workspace and launch an assigned lab.

## Steps

1. Create the tenant record (Admin → Workspaces → new tenant/organization).
2. Create the workspace: name, organization, slug, access type
   (`WORKSPACE_URL` or `USER_SESSION_URL`), status.
3. Confirm the branded URL from the workspace access panel and share it with the customer.
4. Bind a cloud connection to the workspace (super admin, Admin → Cloud → Connections).
5. Import or select an image template (Admin → Cloud → Image Templates).
6. Register pool VMs for that template and Sync.
7. Create labs (Draft → Configure → Assign users → Publish).
8. Add workspace users and lab assignments; see [user-invitations.md](user-invitations.md).
9. Validate as a test learner: sign in, launch, connect, stop.

## Verify

- `tenants`, `workspaces`, `workspace_users`, `labs`, `lab_assignments` rows exist.
- Activity log shows the creation entries under the acting admin.
- Cross-tenant check: a user from another tenant gets 403 on the workspace URL.

## Escalation

Cloud connection or Key Vault problems go to the platform (super admin) owner.
