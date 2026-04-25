/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

(function (root, factory) {
    var exported = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = exported;
    }

    root.AccountAuth = exported;
})(typeof self !== 'undefined' ? self : this, function () {
    var JELLYFIN_CREDENTIALS_KEY = 'jellyfin_credentials';

    function getServerId(serverInfo) {
        return serverInfo && (serverInfo.id || serverInfo.Id || serverInfo.ServerId);
    }

    function getServerName(serverInfo) {
        return serverInfo && (serverInfo.Name || serverInfo.ServerName || serverInfo.name || '');
    }

    function getServerAddress(serverInfo) {
        return serverInfo && (serverInfo.baseurl || serverInfo.ManualAddress || serverInfo.Address || serverInfo.LocalAddress || '');
    }

    function quoteHeader(value) {
        value = value === null || value === undefined ? '' : String(value);
        return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    function buildAuthorizationHeader(appInfo, accountOrDeviceId, token) {
        var deviceId = typeof accountOrDeviceId === 'string' ? accountOrDeviceId : accountOrDeviceId.deviceId;
        var accessToken = token || accountOrDeviceId.accessToken || '';
        var parts = [];

        parts.push('Client=' + quoteHeader(appInfo.appName));
        parts.push('Device=' + quoteHeader(appInfo.deviceName));
        parts.push('DeviceId=' + quoteHeader(deviceId));
        parts.push('Version=' + quoteHeader(appInfo.appVersion));

        if (accessToken) {
            parts.push('Token=' + quoteHeader(accessToken));
        }

        return 'MediaBrowser ' + parts.join(', ');
    }

    function buildAuthHeaders(appInfo, account) {
        return {
            'Authorization': buildAuthorizationHeader(appInfo, account),
            'X-Emby-Token': account.accessToken,
            'X-MediaBrowser-Token': account.accessToken
        };
    }

    function classifyValidationFailure(data) {
        var status = data && data.error;

        if (status === 401 || status === 403) {
            return 'revoked';
        }

        if (status === 'timeout' || status === 'abort' || status === 0 || status >= 500) {
            return 'network';
        }

        return 'invalid';
    }

    function validateToken(ajaxClient, serverInfo, account, appInfo, callbacks) {
        callbacks = callbacks || {};

        if (!account || !account.accessToken) {
            if (callbacks.invalid) {
                callbacks.invalid({ reason: 'revoked' });
            }
            return null;
        }

        var baseurl = getServerAddress(serverInfo);
        var separator = baseurl.charAt(baseurl.length - 1) === '/' ? '' : '/';
        var url = baseurl + separator + 'Users/' + encodeURIComponent(account.userId);

        return ajaxClient.request(url, {
            method: 'GET',
            headers: buildAuthHeaders(appInfo, account),
            success: function (user) {
                if (callbacks.success) {
                    callbacks.success(user);
                }
            },
            error: function (data) {
                var reason = classifyValidationFailure(data);
                if (reason === 'network' && callbacks.networkError) {
                    callbacks.networkError(data);
                } else if (callbacks.invalid) {
                    callbacks.invalid({
                        reason: reason,
                        data: data
                    });
                }
            },
            abort: function (data) {
                if (callbacks.networkError) {
                    callbacks.networkError(data);
                }
            },
            timeout: 5000
        });
    }

    function createJellyfinWebServerCredential(serverInfo, account, timestamp) {
        return {
            Id: getServerId(serverInfo),
            Name: getServerName(serverInfo),
            ManualAddress: getServerAddress(serverInfo),
            LastConnectionMode: 2,
            manualAddressOnly: true,
            UserId: account && account.accessToken ? account.userId : null,
            AccessToken: account && account.accessToken ? account.accessToken : null,
            DateLastAccessed: timestamp || new Date().getTime()
        };
    }

    function mergeJellyfinWebCredential(rawCredentials, serverCredential) {
        var credentials = rawCredentials || {};
        var servers = credentials.Servers || [];
        var merged = [];
        var found = false;

        for (var i = 0; i < servers.length; i++) {
            if (servers[i] && servers[i].Id === serverCredential.Id) {
                merged.push(serverCredential);
                found = true;
            } else {
                merged.push(servers[i]);
            }
        }

        if (!found) {
            merged.push(serverCredential);
        }

        credentials.Servers = merged;
        return credentials;
    }

    function clearUserCache(storage, serverId) {
        if (!storage || !serverId || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
            return;
        }

        var keysToRemove = [];
        for (var i = 0; i < storage.length; i++) {
            var key = storage.key(i);
            if (key && key.indexOf('user-') === 0 && key.lastIndexOf('-' + serverId) === key.length - serverId.length - 1) {
                keysToRemove.push(key);
            }
        }

        for (var j = 0; j < keysToRemove.length; j++) {
            storage.removeItem(keysToRemove[j]);
        }
    }

    function seedJellyfinWebCredentials(storage, serverCredential) {
        var raw = storage.getItem(JELLYFIN_CREDENTIALS_KEY);
        var credentials = raw ? JSON.parse(raw) : {};
        var merged = mergeJellyfinWebCredential(credentials, serverCredential);

        storage.setItem(JELLYFIN_CREDENTIALS_KEY, JSON.stringify(merged));
        clearUserCache(storage, serverCredential.Id);

        return merged;
    }

    function createCredentialSeedUrl(serverInfo, nonce) {
        var baseurl = getServerAddress(serverInfo);
        var separator = baseurl.charAt(baseurl.length - 1) === '/' ? '' : '/';
        return baseurl + separator + 'System/Info/Public?jf_webos_credential_seed=' + encodeURIComponent(nonce);
    }

    function createCredentialSeedScript(serverCredential, reloadUrl, nonce) {
        return [
            '(function () {',
            '  var key = ' + JSON.stringify(JELLYFIN_CREDENTIALS_KEY) + ';',
            '  var credential = ' + JSON.stringify(serverCredential) + ';',
            '  var marker = "jf-webos-credential-seed";',
            '  var nonce = ' + JSON.stringify(nonce) + ';',
            '  try {',
            '    var raw = localStorage.getItem(key);',
            '    var credentials = raw ? JSON.parse(raw) : {};',
            '    var servers = credentials.Servers || [];',
            '    var merged = [];',
            '    var found = false;',
            '    for (var i = 0; i < servers.length; i++) {',
            '      if (servers[i] && servers[i].Id === credential.Id) {',
            '        merged.push(credential);',
            '        found = true;',
            '      } else {',
            '        merged.push(servers[i]);',
            '      }',
            '    }',
            '    if (!found) { merged.push(credential); }',
            '    credentials.Servers = merged;',
            '    localStorage.setItem(key, JSON.stringify(credentials));',
            '    for (var j = localStorage.length - 1; j >= 0; j--) {',
            '      var userKey = localStorage.key(j);',
            '      if (userKey && userKey.indexOf("user-") === 0 && userKey.lastIndexOf("-" + credential.Id) === userKey.length - credential.Id.length - 1) {',
            '        localStorage.removeItem(userKey);',
            '      }',
            '    }',
            '    if (sessionStorage.getItem(marker) !== nonce) {',
            '      sessionStorage.setItem(marker, nonce);',
            '      window.location.replace(' + JSON.stringify(reloadUrl) + ');',
            '    }',
            '  } catch (err) {',
            '    console.error("Failed to seed Jellyfin credentials", err);',
            '  }',
            '}());'
        ].join('\n');
    }

    return {
        JELLYFIN_CREDENTIALS_KEY: JELLYFIN_CREDENTIALS_KEY,
        buildAuthorizationHeader: buildAuthorizationHeader,
        buildAuthHeaders: buildAuthHeaders,
        classifyValidationFailure: classifyValidationFailure,
        validateToken: validateToken,
        createJellyfinWebServerCredential: createJellyfinWebServerCredential,
        mergeJellyfinWebCredential: mergeJellyfinWebCredential,
        clearUserCache: clearUserCache,
        seedJellyfinWebCredentials: seedJellyfinWebCredentials,
        createCredentialSeedUrl: createCredentialSeedUrl,
        createCredentialSeedScript: createCredentialSeedScript
    };
});
