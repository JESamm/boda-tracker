# Privacy and location policy status

## Data model scope

The schema can store names, normalized phone numbers, SACCO membership, vehicle assignment, work and trip history, reported fare/expense amounts, GPS coordinates, timestamps, and audit metadata. The rider app currently requests foreground location only when the rider taps the location control to preview a route. It sends the origin and destination to the API, which forwards route coordinates to the public OSRM demo service; typed place searches are sent to the public Photon demo, and map tiles are proxied from OpenStreetMap. These prototype map requests are not stored in the Boda-Tracker database, but the public providers receive them under their own policies. The app does not currently collect continuous location history.

## Proposed defaults

- Collect location only for an explicitly disclosed operational purpose during an eligible active work session after the rider grants Android permission.
- Keep prototype map previews distinct from operational tracking: request location only on rider action, explain which public providers receive search text and coordinates, and do not treat route previews as a safety or dispatch system.
- Show tracking and synchronization state in the rider app; honor permission revocation, GPS-off state, session end, and account/SACCO suspension.
- Store device capture time separately from server receive time; mark freshness rather than presenting stale data as live.
- Retain only necessary location history for a defined, documented period. Keep operational financial records and audit history under separate retention rules.
- Restrict personal/location reads and exports by role and SACCO; minimize data in logs, notifications, and Socket.IO payloads.

## Decisions required before pilot

- Confirm the SACCO's lawful purposes and appropriate notices/consents for worker location tracking.
- Set location sampling and retention periods based on operational need and battery/connectivity testing.
- Establish access, correction, deletion, complaint, and incident workflows.
- Obtain Kenya-specific legal/privacy advice on the Data Protection Act, 2019 and applicable regulations, including whether registration, a DPIA, or other obligations apply.

No legal-compliance claim is made by this document.
