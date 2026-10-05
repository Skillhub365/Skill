# Runbook: quota and SKU failures

## Symptoms

Azure errors such as `OperationNotAllowed` (quota exceeded), `SkuNotAvailable`,
`AllocationFailed`, or `ZonalAllocationFailed` during VM start or creation.

## Investigate

1. Identify the SKU family, region and subscription from the template / cloud connection.
2. Check regional vCPU quota for that family in the subscription.
3. Check whether the SKU is offered in the region/zone at all.
4. Look for a burst of concurrent launches in `sessions` and `activity_logs`.

## Remediate

- Request a quota increase for the family and region.
- Move the template to an available SKU of equivalent size and re-register pool VMs.
- Remove zone pinning, or pick a different zone/region.
- Lower `MAX_CONCURRENT_SESSIONS_PER_USER` or shrink demand until capacity lands.
- Keep the pool sized to the approved quota so learners fail fast with `VM_UNAVAILABLE`
  instead of hitting Azure allocation errors.

## Verify

Test launch succeeds; pool Sync shows the expected machines; no new allocation errors
for 30 minutes.

## Escalation

Quota increases can take hours — inform the tenant admin and cap bookings meanwhile.
