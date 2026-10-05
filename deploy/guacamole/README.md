# Remote access gateway (Apache Guacamole)

Real browser-based access to lab machines:

```
Browser --HTTPS/WSS:443--> nginx --> Guacamole web app --> guacd --RDP:3389--> private Azure VM
```

## Deploy

1. Place the stack on a host inside (or peered to) the lab VNet.
2. Generate the database schema and TLS material:
   ```bash
   docker run --rm guacamole/guacamole:1.5.5 /opt/guacamole/bin/initdb.sh --postgresql > initdb.sql
   # certs/fullchain.pem + certs/privkey.pem (Let's Encrypt, Azure Key Vault cert, or your CA)
   ```
3. `POSTGRES_PASSWORD=… docker compose up -d`
4. Sign in once as `guacadmin`, create the SkillTrack service account with
   administer-connections and administer-users permissions, and delete or
   disable `guacadmin`.

## Network rules

- Publish only 443 on the gateway host.
- The lab VM NSG allows 3389 **only** from the gateway subnet; no public IP,
  no inbound RDP from the internet.
- guacd has no published ports and is reachable only from the web app.

## SkillTrack configuration

| Variable | Purpose |
| --- | --- |
| `GUACAMOLE_URL` | Internal base URL SkillTrack calls (e.g. `http://guacamole:8080/guacamole`) |
| `GUACAMOLE_PUBLIC_URL` | Browser-facing origin, e.g. `https://labs.skilltracklabs.com` |
| `GUACAMOLE_USERNAME` / `GUACAMOLE_ADMIN_PASSWORD` | SkillTrack service account |
| `GUACAMOLE_DATA_SOURCE` | `postgresql` (default) |
| `LAB_VM_USERNAME` / `LAB_VM_PASSWORD` / `LAB_VM_DOMAIN` | RDP identity injected server-side |
| `LAB_RDP_SECURITY` | `nla` (default), `tls`, `rdp`, `any` |
| `LAB_CLIPBOARD` | `readwrite` (default), `readonly`, `disabled` |
| `GUACAMOLE_REQUEST_TIMEOUT_MS` / `GUACAMOLE_CONNECT_TIMEOUT_MS` | Gateway call and desktop-connect budgets |

Set `SKILLTRACK_ENV=staging|production` to switch off the simulated desktop.

## Per-session isolation

For each SkillTrack session the backend creates a dedicated RDP connection
plus an ephemeral Guacamole account that can read only that connection. The
browser receives a token for that account, so changing a VM or connection ID
in the URL grants nothing. Both objects are deleted — and any live tunnel
killed — when the session stops, expires or fails.
