# Multi-User Wrapper Architecture

## Overview

The WebOS client is a launcher shell around the server-hosted Jellyfin Web UI. The multi-user implementation keeps that model and adds a thin wrapper in two places:

1. The launcher now owns persisted device-level account selection.
2. The injected WebOS adapter now bootstraps the remote web app with the selected user's credentials and a per-user storage namespace.

This avoids rewriting Jellyfin Web itself while still supporting:

- Multiple saved accounts on one TV
- Different users on the same server
- Different users on different servers
- Fast user switching without asking the server to re-authenticate every time

## Module Breakdown

### `frontend/js/index.js`

Launcher orchestration and device-level multi-user state.

Responsibilities:

- Startup decision: auto-resume one saved user or show picker when multiple exist
- Persist saved Jellyfin accounts, active user state, and PIN protection
- Add-account flow using the existing server discovery/connect screen
- Session picker UI, remove-user actions, and PIN management
- Remote navigation across launcher views
- Server validation and manifest lookup
- Proxy-loading the remote Jellyfin Web entry page with injected bootstrap code
- Handling sign-in and sign-out messages from the embedded web app

### `frontend/js/multiUser.js`

Pre-boot wrapper for the embedded Jellyfin Web page.

Responsibilities:

- Seed `localStorage["jellyfin_credentials"]` with the selected user/server
- Namespace browser-side local storage per saved user
- Provide a stub `ApiClient.serverAddress()` before Jellyfin Web initializes
- Re-apply the active user's credentials to the real `ApiClient`

### `frontend/js/webOS.js`

Native shell bridge.

Additional responsibilities:

- Report `onLocalUserSignedIn` and `onLocalUserSignedOut` back to the launcher
- Open the launcher user switcher when Jellyfin Web calls `selectServer`

## Storage Schema

Saved under launcher `localStorage` key `jellyfin_multi_user_v1`:

```json
{
  "version": 1,
  "activeSessionId": "aHR0cDovL2phbGx5ZmluLmxvY2FsOjgwOTY:user-1",
  "sessions": {
    "aHR0cDovL2phbGx5ZmluLmxvY2FsOjgwOTY:user-1": {
      "id": "aHR0cDovL2phbGx5ZmluLmxvY2FsOjgwOTY:user-1",
      "baseurl": "http://jellyfin.local:8096",
      "hosturl": "http://jellyfin.local:8096/web/index.html#!/home.html",
      "serverId": "server-guid",
      "serverName": "Living Room Jellyfin",
      "userId": "user-guid",
      "displayName": "Tim",
      "accessToken": "token-value",
      "lastUsedAt": 1775157234000,
      "lastError": null
    }
  }
}
```

Per-user browser state inside the embedded Jellyfin Web app is stored under namespaced keys:

```text
jfmu:<sessionId>:<originalLocalStorageKey>
```

Examples:

```text
jfmu:aHR0...:enableAutoLogin
jfmu:aHR0...:user-user-guid-server-guid
```

The shared Jellyfin credential key remains un-namespaced so Jellyfin Web can boot normally:

```text
jellyfin_credentials
```

## Wrapped API Client Strategy

Jellyfin Web already centralizes most requests through `window.ApiClient`. The wrapper uses that instead of touching every request site.

`frontend/js/multiUser.js`:

```js
function syncApiClient(apiClient) {
    var serverInfo = typeof apiClient.serverInfo === 'function' ? (apiClient.serverInfo() || {}) : {};

    serverInfo.Id = server.serverId || serverInfo.Id || '';
    serverInfo.Name = server.serverName || serverInfo.Name || '';
    serverInfo.ManualAddress = server.baseurl || serverInfo.ManualAddress || '';
    serverInfo.UserId = activeSession ? (activeSession.userId || null) : null;
    serverInfo.AccessToken = activeSession ? (activeSession.accessToken || null) : null;

    apiClient.serverInfo(serverInfo);
    apiClient.serverAddress(server.baseurl);
    apiClient.setAuthenticationInfo(serverInfo.AccessToken || null, serverInfo.UserId || null);
}
```

That function is applied on startup and before `ajax()` / `fetch()` calls so the active session is always the source of truth.

## User Session Manager Example

`frontend/js/index.js`:

```js
USER_SESSION_MANAGER.prototype.upsertSession = function (sessionData) {
    var normalizedBaseurl = this._normalizeBaseUrl(sessionData.baseurl);
    var sessionId = this._buildSessionId(normalizedBaseurl, sessionData.userId);
    var store = this._readStore();

    store.sessions[sessionId] = {
        id: sessionId,
        baseurl: normalizedBaseurl,
        hosturl: sessionData.hosturl || '',
        serverId: sessionData.serverId || '',
        serverName: sessionData.serverName || '',
        userId: sessionData.userId,
        displayName: sessionData.displayName || sessionData.userId,
        accessToken: typeof sessionData.accessToken !== 'undefined' ? sessionData.accessToken : null,
        lastUsedAt: sessionData.lastUsedAt || new Date().getTime(),
        lastError: sessionData.lastError || null
    };

    store.activeSessionId = sessionId;
    this._writeStore(store);
    return store.sessions[sessionId];
};
```

## Startup Flow

1. Launcher loads `jellyfin_multi_user_v1`.
2. If multiple sessions exist, the launcher shows the user picker.
3. If exactly one valid session exists, the launcher resumes it automatically.
4. The launcher verifies the selected server with `/System/Info/Public` and `/web/manifest.json`.
5. The launcher fetches the remote Jellyfin Web entry HTML and injects `multiUser.js` and `webOS.js` before Jellyfin Web boots.
6. The injected bootstrap seeds `jellyfin_credentials`, applies the per-user namespace, and lets Jellyfin Web auto-login with the saved token.

## Login Flow

1. User selects `Add account`.
2. Existing server discovery/manual connect flow runs unchanged.
3. Jellyfin Web shows its normal sign-in UI for that server.
4. After a successful login, Jellyfin Web calls `NativeShell.onLocalUserSignedIn`.
5. The launcher receives the message and upserts the session into `jellyfin_multi_user_v1`.

## Switch User Flow

1. User opens the existing multi-server action in Jellyfin Web.
2. `NativeShell.selectServer()` routes back to the launcher picker.
3. Launcher hides the embedded app and shows saved users.
4. Selecting another user rebuilds `jellyfin_credentials` and reloads the embedded app for the new active session.
5. Since the token is already stored, Jellyfin Web reconnects without asking for credentials again.

## Edge Cases

- Expired token: the wrapper keeps the profile, clears the usable auth state, and marks the session as needing sign-in again.
- Server unreachable: the launcher returns to the picker or add-account form and shows the connection error without affecting other users.
- Server identity changed: the wrapper invalidates the saved token for that profile so it cannot leak into a different server.
- Removing users: removing a profile deletes the saved session and clears its namespaced browser state.
