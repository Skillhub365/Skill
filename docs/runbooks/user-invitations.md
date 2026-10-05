# Runbook: user invitations

## Steps

1. Admin → Workspaces → *workspace* → Users → add the user (email).
2. Assign the role: `user` for learners; `admin` only for tenant staff.
3. Assign published labs to the user (lab assignments).
4. Send the branded workspace URL. First sign-in creates the profile automatically.

## Symptoms and causes

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No labs assigned" | Lab not published, or no assignment row | Publish / assign |
| 403 on the workspace URL | Missing `workspace_users` row or wrong tenant | Add membership |
| Sign-in works, admin screens missing | No `admin` row in `user_roles` | Grant the role |
| Invite email never arrives | Auth email delivery | Check email logs; share the URL directly |

## Suspension

Remove or suspend the `workspace_users` row. Access stops at the next request;
terminate any live session from Admin → Sessions to cut the desktop immediately.

## Verify

`profiles`, `user_roles`, `workspace_users`, `lab_assignments` rows plus an
`activity_logs` entry for the change.
