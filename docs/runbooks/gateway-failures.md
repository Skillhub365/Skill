# Runbook: gateway (Guacamole) failures

## Symptoms

Desktop stuck in CONNECTING, `ERROR` state in the viewport, or the connection endpoint
returning a gateway error while the VM is READY.

## Likely causes

- Gateway service account password changed or locked out.
- `GUACAMOLE_PUBLIC_URL` not HTTPS, or TLS certificate expired.
- WebSocket upgrade blocked by an intermediate proxy.
- NSG no longer allows 3389 from the gateway subnet.
- guacd container down; Guacamole database unavailable.
- RDP credentials or security mode mismatched with the image.

## Investigate

1. `GET /api/infra/status` → `gateway.reachable` and detail.
2. `docker compose ps` / `logs guacamole guacd nginx` on the gateway host.
3. `curl -sk https://<gateway>/` from outside; check certificate expiry.
4. From the gateway host: `nc -vz <vm-private-ip> 3389`.
5. Browser console/network for the WSS upgrade.

## Remediate

- Restart `guacd` / `guacamole` containers; verify the Postgres backend is up.
- Renew TLS material in `deploy/guacamole/certs` and reload NGINX.
- Fix the NSG rule (3389 from the gateway subnet only).
- Rotate and re-store the service account password ([secret-rotation.md](secret-rotation.md)).
- Adjust `LAB_RDP_SECURITY` / `LAB_RDP_IGNORE_CERT` to match the image.
- Delete leftover ephemeral users/connections for dead sessions.

## Verify

A fresh launch connects; the ephemeral user and connection are created and then removed
on stop; no gateway errors for 30 minutes.

## Escalation

Gateway host or network-level failure → infrastructure owner. Consider scaling to a
second gateway host behind the load balancer if load-related.
