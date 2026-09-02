# Dock v0.3.2 License Gate

This build adds district license enforcement.

Allowed statuses: active, trial, grace, past_due.
Blocked statuses: suspended, inactive, expired, canceled, cancelled, disabled, terminated.

Managed config payload can include:

```json
"license": {
  "plan": "district",
  "status": "active",
  "expiresAt": "2027-08-18T00:00:00Z",
  "graceUntil": "2027-09-01T00:00:00Z",
  "maxUsers": 500,
  "minExtensionVersion": "0.3.2"
}
```

Diagnostics includes a local suspended-license test button.
