# Parish Magazine Distribution PWA

Installable JavaScript PWA for the magazine list. It uses the supplied October 2026 transcriptions as its initial data and stores the list in IndexedDB on each device.

## Included

- Five areas: Waltham Chase, Shedfield, Shirrell Heath, Wickham, and Extras.
- Mobile route cards and a wider table-like layout for tablets and computers.
- Offline access after the site has been opened once while online.
- Local route add, edit, delete, and collection tracking in Admin preview mode.
- A preconfigured link to the supplied Google Sheet and a refresh action.
- No Flutter, Android Studio, JavaScript framework, package installation, or build step.

## Open and install

The files must be served from an HTTPS website for installation and offline caching to work (localhost also works for local preview). Upload the contents of this folder to a static website host, then open its HTTPS link in Chrome on Android and choose **Install app** or **Add to Home screen** from the browser menu. On iPhone/iPad, open in Safari and use **Share → Add to Home Screen**.

Opening `index.html` directly from a file manager is not enough: browsers disable service workers and IndexedDB features for `file://` pages.

## Google Sheet

The app starts with the supplied sheet link. It expects one flat table with headers `Parish`, `Route`, and `Number of mags`; it also reads `Distributor`, `Initials`, `Collected from Church`, `Updated by`, and `Updated date`. Share the sheet as **Anyone with the link → Viewer**.

The PWA attempts to fetch the Google Sheets CSV export. Some hosting/browser combinations may block that request through cross-origin restrictions; if refresh reports that the sheet is unavailable despite its sharing being correct, a small secure proxy or a CSV import endpoint will be needed. The last successfully loaded records remain saved locally for offline use.

## Admin and syncing

The Admin/Viewer control is a local UI preview, not a secure login. Admin edits are saved on the device and tracked as pending. The public read-only Google Sheet connection can import changes from the sheet but cannot write app edits back. A secure authenticated write endpoint is needed before enabling shared Admin editing.

The seed rows were transcribed from the supplied photographs. The original spreadsheet photos do not include `Updated by` or `Updated date`, so those fields start empty.
