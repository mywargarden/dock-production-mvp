# Privacy and Permissions Draft

Dock captures page titles, URLs, favicons, optional user notes/reasons, and screenshots when a user intentionally saves pages. This data is used to render the user's personal Safe Harbor library and, in district mode, to show managed workspace cards.

## Data collected for personal memories

- Page title
- Page URL
- Optional reason/note
- Favicon URL when it is a normal HTTP/HTTPS URL
- Screenshot Storage URL when screenshot upload succeeds
- Screenshot blocked/unavailable flag when screenshot capture fails

## Screenshot policy

Dock should not store full screenshot base64 in the database. Screenshots are uploaded as files and referenced by `screenshot_url`. The database column `screenshot_data_url` should remain `NULL` for new saves.

## Permissions rationale

- `tabs`: needed to read current/open tab metadata and perform Dock'em All.
- `activeTab`: needed for user-initiated capture of the active page.
- `storage`: needed for local Safe Harbor state, auth state, and workspace cache.
- `alarms`: needed for periodic managed workspace sync.
- `identity` and `identity.email`: needed for Google/Supabase sign-in and user association.
- `<all_urls>` host permission: needed only if Dock is expected to save and screenshot arbitrary web pages. If store review friction becomes high, consider narrowing or using optional host permissions.

## User controls

Users should be able to:

- Save a page intentionally.
- Delete personal memories.
- Sign out.
- Understand when screenshots are unavailable.
- Request data deletion/export when account features mature.
