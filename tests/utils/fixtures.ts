/**
 * Tenant-aware fixtures shared by every test.
 *
 * Two organisations exist on purpose: a great deal of the platform's security
 * value is "tenant A can never see tenant B", and that is only testable with
 * two tenants in every seed.
 */

import type { Row, Tables } from "./fake-supabase";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";

export const IDS = {
  learner: "aaaaaaa1-0000-4000-8000-000000000001",
  otherLearner: "aaaaaaa1-0000-4000-8000-000000000002",
  admin: "aaaaaaa1-0000-4000-8000-000000000003",
  superadmin: "aaaaaaa1-0000-4000-8000-000000000004",
  foreignLearner: "aaaaaaa1-0000-4000-8000-000000000005",
  suspended: "aaaaaaa1-0000-4000-8000-000000000006",
  workspaceA: "bbbbbbb1-0000-4000-8000-000000000001",
  workspaceArchived: "bbbbbbb1-0000-4000-8000-000000000002",
  workspaceB: "bbbbbbb1-0000-4000-8000-000000000003",
  templateA: "ccccccc1-0000-4000-8000-000000000001",
  templateDisabled: "ccccccc1-0000-4000-8000-000000000002",
  templateAws: "ccccccc1-0000-4000-8000-000000000003",
  labPublished: "ddddddd1-0000-4000-8000-000000000001",
  labDraft: "ddddddd1-0000-4000-8000-000000000002",
  labArchivedWorkspace: "ddddddd1-0000-4000-8000-000000000003",
  labNoTemplate: "ddddddd1-0000-4000-8000-000000000004",
  labDisabledTemplate: "ddddddd1-0000-4000-8000-000000000005",
  labAwsTemplate: "ddddddd1-0000-4000-8000-000000000006",
  labTenantB: "ddddddd1-0000-4000-8000-000000000007",
  connectionA: "eeeeeee1-0000-4000-8000-000000000001",
} as const;

export interface TestPrincipal {
  sub: string;
  name: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  org: string;
  tenantId: string | null;
  workspaces: string[];
  labs: string[];
  idp: "password" | "entra";
  iat: number;
  exp: number;
  workspaceIds: string[];
  labIds: string[];
  capabilities: string[];
  status: string;
}

/** A fully hydrated principal, exactly as identity resolution would build it. */
export function fakePrincipal(overrides: Partial<TestPrincipal> = {}): TestPrincipal {
  const now = Math.floor(Date.now() / 1000);
  const base: TestPrincipal = {
    sub: IDS.learner,
    name: "Test Learner",
    email: "learner@tenant-a.test",
    role: "user",
    org: "Tenant A",
    tenantId: TENANT_A,
    workspaces: [IDS.workspaceA],
    workspaceIds: [IDS.workspaceA],
    labs: [IDS.labPublished],
    labIds: [IDS.labPublished],
    capabilities: [],
    status: "active",
    idp: "password",
    iat: now,
    exp: now + 900,
  };
  return { ...base, ...overrides };
}

export function adminPrincipal(overrides: Partial<TestPrincipal> = {}): TestPrincipal {
  return fakePrincipal({
    sub: IDS.admin,
    name: "Test Admin",
    email: "admin@tenant-a.test",
    role: "admin",
    workspaces: [IDS.workspaceA],
    workspaceIds: [IDS.workspaceA],
    labs: [],
    labIds: [],
    ...overrides,
  });
}

export function superAdminPrincipal(overrides: Partial<TestPrincipal> = {}): TestPrincipal {
  return adminPrincipal({
    sub: IDS.superadmin,
    name: "Test Super Admin",
    email: "superadmin@tenant-a.test",
    role: "superadmin",
    ...overrides,
  });
}

function timestamps(): Row {
  return { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

/** Deterministic two-tenant catalogue seed for the fake Supabase client. */
export function seedTables(): Tables {
  return {
    tenants: [
      { id: TENANT_A, name: "Tenant A", max_concurrent_sessions: null, max_session_minutes: null, ...timestamps() },
      { id: TENANT_B, name: "Tenant B", max_concurrent_sessions: null, max_session_minutes: null, ...timestamps() },
    ],
    profiles: [
      {
        id: IDS.learner,
        email: "learner@tenant-a.test",
        full_name: "Test Learner",
        status: "active",
        tenant_id: TENANT_A,
        ...timestamps(),
      },
      {
        id: IDS.otherLearner,
        email: "other@tenant-a.test",
        full_name: "Other Learner",
        status: "active",
        tenant_id: TENANT_A,
        ...timestamps(),
      },
      {
        id: IDS.admin,
        email: "admin@tenant-a.test",
        full_name: "Test Admin",
        status: "active",
        tenant_id: TENANT_A,
        ...timestamps(),
      },
      {
        id: IDS.foreignLearner,
        email: "learner@tenant-b.test",
        full_name: "Foreign Learner",
        status: "active",
        tenant_id: TENANT_B,
        ...timestamps(),
      },
      {
        id: IDS.suspended,
        email: "suspended@tenant-a.test",
        full_name: "Suspended Learner",
        status: "suspended",
        tenant_id: TENANT_A,
        ...timestamps(),
      },
    ],
    user_roles: [
      { user_id: IDS.learner, role: "user" },
      { user_id: IDS.otherLearner, role: "user" },
      { user_id: IDS.foreignLearner, role: "user" },
      { user_id: IDS.suspended, role: "user" },
      { user_id: IDS.admin, role: "admin" },
      { user_id: IDS.superadmin, role: "superadmin" },
    ],
    workspaces: [
      {
        id: IDS.workspaceA,
        tenant_id: TENANT_A,
        name: "Cloud Security Lab",
        slug: "tenant-a-cloud-security",
        status: "active",
        cloud_connection_id: IDS.connectionA,
        default_template_id: IDS.templateA,
        max_concurrent_sessions: null,
        max_session_minutes: null,
        ...timestamps(),
      },
      {
        id: IDS.workspaceArchived,
        tenant_id: TENANT_A,
        name: "Retired Workspace",
        slug: "tenant-a-retired",
        status: "archived",
        cloud_connection_id: IDS.connectionA,
        default_template_id: IDS.templateA,
        max_concurrent_sessions: null,
        max_session_minutes: null,
        ...timestamps(),
      },
      {
        id: IDS.workspaceB,
        tenant_id: TENANT_B,
        name: "Tenant B Workspace",
        slug: "tenant-b-main",
        status: "active",
        cloud_connection_id: null,
        default_template_id: null,
        max_concurrent_sessions: null,
        max_session_minutes: null,
        ...timestamps(),
      },
    ],
    workspace_users: [
      {
        id: "wu-1",
        workspace_id: IDS.workspaceA,
        user_id: IDS.learner,
        status: "active",
        capabilities: ["lab:start"],
        ...timestamps(),
      },
      {
        id: "wu-2",
        workspace_id: IDS.workspaceA,
        user_id: IDS.otherLearner,
        status: "active",
        capabilities: [],
        ...timestamps(),
      },
      {
        id: "wu-3",
        workspace_id: IDS.workspaceB,
        user_id: IDS.foreignLearner,
        status: "active",
        capabilities: [],
        ...timestamps(),
      },
    ],
    templates: [
      {
        id: IDS.templateA,
        tenant_id: TENANT_A,
        name: "Windows 11 Lab Image",
        status: "active",
        cloud_provider: "azure",
        region: "westeurope",
        vm_size: "Standard_D4s_v5",
        image: "/subscriptions/fake/images/win11-lab/versions/1.0.0",
        cloud_connection_id: IDS.connectionA,
        ...timestamps(),
      },
      {
        id: IDS.templateDisabled,
        tenant_id: TENANT_A,
        name: "Disabled Image",
        status: "disabled",
        cloud_provider: "azure",
        region: "westeurope",
        vm_size: "Standard_D2s_v5",
        image: "/subscriptions/fake/images/old/versions/1.0.0",
        cloud_connection_id: IDS.connectionA,
        ...timestamps(),
      },
      {
        id: IDS.templateAws,
        tenant_id: TENANT_A,
        name: "Unsupported Provider Image",
        status: "active",
        cloud_provider: "aws",
        region: "eu-west-1",
        vm_size: "t3.large",
        image: "ami-fake",
        cloud_connection_id: null,
        ...timestamps(),
      },
    ],
    labs: [
      {
        id: IDS.labPublished,
        workspace_id: IDS.workspaceA,
        template_id: IDS.templateA,
        title: "Defend the Cloud",
        status: "published",
        duration_minutes: 120,
        max_extensions: 2,
        ...timestamps(),
      },
      {
        id: IDS.labDraft,
        workspace_id: IDS.workspaceA,
        template_id: IDS.templateA,
        title: "Unpublished Lab",
        status: "draft",
        duration_minutes: 60,
        max_extensions: 1,
        ...timestamps(),
      },
      {
        id: IDS.labArchivedWorkspace,
        workspace_id: IDS.workspaceArchived,
        template_id: IDS.templateA,
        title: "Lab In Retired Workspace",
        status: "published",
        duration_minutes: 60,
        max_extensions: 1,
        ...timestamps(),
      },
      {
        id: IDS.labDisabledTemplate,
        workspace_id: IDS.workspaceA,
        template_id: IDS.templateDisabled,
        title: "Lab With Disabled Image",
        status: "published",
        duration_minutes: 60,
        max_extensions: 1,
        ...timestamps(),
      },
      {
        id: IDS.labAwsTemplate,
        workspace_id: IDS.workspaceA,
        template_id: IDS.templateAws,
        title: "Lab With Unsupported Provider",
        status: "published",
        duration_minutes: 60,
        max_extensions: 1,
        ...timestamps(),
      },
      {
        id: IDS.labTenantB,
        workspace_id: IDS.workspaceB,
        template_id: null,
        title: "Tenant B Lab",
        status: "published",
        duration_minutes: 60,
        max_extensions: 1,
        ...timestamps(),
      },
    ],
    lab_assignments: [
      { id: "la-1", lab_id: IDS.labPublished, user_id: IDS.learner, status: "active", ...timestamps() },
      { id: "la-2", lab_id: IDS.labPublished, user_id: IDS.otherLearner, status: "revoked", ...timestamps() },
      { id: "la-3", lab_id: IDS.labDisabledTemplate, user_id: IDS.learner, status: "active", ...timestamps() },
      { id: "la-4", lab_id: IDS.labAwsTemplate, user_id: IDS.learner, status: "active", ...timestamps() },
      { id: "la-5", lab_id: IDS.labArchivedWorkspace, user_id: IDS.learner, status: "active", ...timestamps() },
      { id: "la-6", lab_id: IDS.labDraft, user_id: IDS.learner, status: "active", ...timestamps() },
    ],
    sessions: [],
    session_events: [],
    lifecycle_events: [],
    vm_pool_entries: [],
    security_events: [],
    cloud_connections: [],
    gateway_connections: [],
  };
}

/** Authorization header helper — the token is opaque and always fake. */
export function bearer(token = "test-access-token") {
  return { authorization: `Bearer ${token}` };
}