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

    root.AccountStore = exported.AccountStore;
    root.createAccountStore = function (storageBackend) {
        return new exported.AccountStore(storageBackend);
    };

    if (root.storage && !root.accountStore) {
        root.accountStore = new exported.AccountStore(root.storage);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    var STORAGE_KEY = 'jf_multiuser_v1';

    function now() {
        return new Date().getTime();
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function publicAccount(account) {
        var result = clone(account);
        result.pinProtected = !!result.pinHash;
        delete result.pinHash;
        delete result.pinSalt;
        return result;
    }

    function readStorage(storageBackend, key) {
        var value = storageBackend.get(key);
        if (!value) {
            return null;
        }
        return value;
    }

    function writeStorage(storageBackend, key, value) {
        storageBackend.set(key, value);
    }

    function getServerId(serverInfo) {
        return serverInfo && (serverInfo.id || serverInfo.Id || serverInfo.ServerId);
    }

    function getServerName(serverInfo) {
        return serverInfo && (serverInfo.Name || serverInfo.ServerName || serverInfo.name || '');
    }

    function getServerAddress(serverInfo) {
        return serverInfo && (serverInfo.baseurl || serverInfo.ManualAddress || serverInfo.Address || serverInfo.LocalAddress || '');
    }

    function getUserId(user) {
        return user && (user.Id || user.id || user.UserId || user.userId);
    }

    function getUserName(user) {
        return user && (user.Name || user.name || user.UserName || user.userName || '');
    }

    function generateFallbackBytes(length) {
        var bytes = [];
        for (var i = 0; i < length; i++) {
            bytes.push(Math.floor(Math.random() * 256));
        }
        return bytes;
    }

    function toHex(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += ('0' + bytes[i].toString(16)).slice(-2);
        }
        return out;
    }

    function generateDeviceId(randomSource) {
        var bytes;

        if (randomSource && typeof randomSource.getRandomValues === 'function') {
            bytes = new Uint8Array(16);
            randomSource.getRandomValues(bytes);
        } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
        } else {
            bytes = generateFallbackBytes(16);
        }

        return 'webos-' + toHex(bytes);
    }

    function isValidPin(pin) {
        return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
    }

    function hashPin(pin, salt) {
        var input = salt + ':' + pin;
        var hash = 2166136261;

        for (var i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }

        return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
    }

    function normalizeState(state) {
        if (!state || typeof state !== 'object') {
            state = {};
        }

        state.version = 1;
        state.servers = state.servers || {};
        return state;
    }

    function AccountStore(storageBackend) {
        if (!storageBackend) {
            throw new Error('storageBackend is required');
        }

        this.storage = storageBackend;
        this.key = STORAGE_KEY;
    }

    AccountStore.generateDeviceId = generateDeviceId;
    AccountStore.isValidPin = isValidPin;
    AccountStore.hashPin = hashPin;

    AccountStore.prototype._load = function () {
        return normalizeState(readStorage(this.storage, this.key));
    };

    AccountStore.prototype._save = function (state) {
        writeStorage(this.storage, this.key, normalizeState(state));
        return state;
    };

    AccountStore.prototype._server = function (state, serverId) {
        if (!state.servers[serverId]) {
            state.servers[serverId] = {
                selectedAccountId: null,
                accounts: {}
            };
        }

        state.servers[serverId].accounts = state.servers[serverId].accounts || {};
        return state.servers[serverId];
    };

    AccountStore.prototype.getState = function () {
        return clone(this._load());
    };

    AccountStore.prototype.listForServer = function (serverId) {
        var state = this._load();
        var serverState = state.servers[serverId];

        if (!serverState || !serverState.accounts) {
            return [];
        }

        var accounts = [];
        for (var accountId in serverState.accounts) {
            if (serverState.accounts.hasOwnProperty(accountId)) {
                accounts.push(publicAccount(serverState.accounts[accountId]));
            }
        }

        accounts.sort(function (a, b) {
            return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
        });

        return accounts;
    };

    AccountStore.prototype.getSelectedAccount = function (serverId) {
        var state = this._load();
        var serverState = state.servers[serverId];

        if (!serverState || !serverState.selectedAccountId || !serverState.accounts) {
            return null;
        }

        var account = serverState.accounts[serverState.selectedAccountId];
        return account ? publicAccount(account) : null;
    };

    AccountStore.prototype.setSelectedAccount = function (serverId, accountId) {
        var state = this._load();
        var serverState = this._server(state, serverId);

        if (accountId && !serverState.accounts[accountId]) {
            throw new Error('account not found');
        }

        serverState.selectedAccountId = accountId || null;
        this._save(state);
    };

    AccountStore.prototype.saveAuthenticatedAccount = function (serverInfo, user, accessToken, deviceId) {
        var serverId = getServerId(serverInfo);
        var userId = getUserId(user);

        if (!serverId) {
            throw new Error('server id is required');
        }

        if (!userId) {
            throw new Error('user id is required');
        }

        if (!deviceId) {
            throw new Error('device id is required');
        }

        var state = this._load();
        var serverState = this._server(state, serverId);
        var accountId = serverId + ':' + userId;
        var existing = serverState.accounts[accountId] || {};
        var timestamp = now();

        var account = {
            accountId: accountId,
            serverId: serverId,
            serverName: getServerName(serverInfo),
            manualAddress: getServerAddress(serverInfo),
            userId: userId,
            userName: getUserName(user),
            accessToken: accessToken || null,
            deviceId: existing.deviceId || deviceId,
            lastUsedAt: timestamp,
            lastValidatedAt: accessToken ? timestamp : existing.lastValidatedAt || null,
            needsReauth: !accessToken,
            imageTag: user.PrimaryImageTag || user.primaryImageTag || existing.imageTag || null,
            pinHash: existing.pinHash || null,
            pinSalt: existing.pinSalt || null,
            pinSetAt: existing.pinSetAt || null,
            pinLength: existing.pinLength || null
        };

        serverState.accounts[accountId] = account;
        serverState.selectedAccountId = accountId;
        this._save(state);

        return publicAccount(account);
    };

    AccountStore.prototype.updateDisplayInfo = function (serverId, accountId, user) {
        var state = this._load();
        var serverState = this._server(state, serverId);
        var account = serverState.accounts[accountId];

        if (!account) {
            return null;
        }

        account.userName = getUserName(user) || account.userName;
        account.imageTag = user.PrimaryImageTag || user.primaryImageTag || account.imageTag || null;
        account.lastValidatedAt = now();
        account.lastUsedAt = now();
        account.needsReauth = false;

        this._save(state);
        return publicAccount(account);
    };

    AccountStore.prototype.markNeedsReauth = function (serverId, accountId) {
        var state = this._load();
        var serverState = this._server(state, serverId);
        var account = serverState.accounts[accountId];

        if (!account) {
            return null;
        }

        account.accessToken = null;
        account.needsReauth = true;
        this._save(state);
        return publicAccount(account);
    };

    AccountStore.prototype.markUsed = function (serverId, accountId) {
        var state = this._load();
        var serverState = this._server(state, serverId);
        var account = serverState.accounts[accountId];

        if (!account) {
            return null;
        }

        account.lastUsedAt = now();
        serverState.selectedAccountId = accountId;
        this._save(state);
        return publicAccount(account);
    };

    AccountStore.prototype.setPin = function (serverId, accountId, pin) {
        if (!isValidPin(pin)) {
            throw new Error('PIN must be 4 to 6 digits');
        }

        var state = this._load();
        var serverState = this._server(state, serverId);
        var account = serverState.accounts[accountId];

        if (!account) {
            throw new Error('account not found');
        }

        account.pinSalt = generateDeviceId();
        account.pinHash = hashPin(pin, account.pinSalt);
        account.pinSetAt = now();
        account.pinLength = pin.length;
        this._save(state);
        return publicAccount(account);
    };

    AccountStore.prototype.clearPin = function (serverId, accountId) {
        var state = this._load();
        var serverState = this._server(state, serverId);
        var account = serverState.accounts[accountId];

        if (!account) {
            throw new Error('account not found');
        }

        account.pinSalt = null;
        account.pinHash = null;
        account.pinSetAt = null;
        account.pinLength = null;
        this._save(state);
        return publicAccount(account);
    };

    AccountStore.prototype.verifyPin = function (serverId, accountId, pin) {
        var state = this._load();
        var serverState = state.servers[serverId];
        var account = serverState && serverState.accounts && serverState.accounts[accountId];

        if (!account || !account.pinHash || !account.pinSalt) {
            return false;
        }

        if (!isValidPin(pin)) {
            return false;
        }

        return hashPin(pin, account.pinSalt) === account.pinHash;
    };

    AccountStore.prototype.removeAccount = function (serverId, accountId) {
        var state = this._load();
        var serverState = this._server(state, serverId);

        delete serverState.accounts[accountId];

        if (serverState.selectedAccountId === accountId) {
            serverState.selectedAccountId = null;
        }

        this._save(state);
    };

    return {
        AccountStore: AccountStore,
        STORAGE_KEY: STORAGE_KEY,
        generateDeviceId: generateDeviceId
    };
});
