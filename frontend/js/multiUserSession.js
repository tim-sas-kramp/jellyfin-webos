/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var userSessionManager = new USER_SESSION_MANAGER();

function USER_SESSION_MANAGER() {
    this.storageKey = 'jellyfin_multi_user_v1';
    this.namespacePrefix = 'jfmu:';
    this.defaultStore = {
        version: 1,
        activeSessionId: null,
        sessions: {}
    };
}

USER_SESSION_MANAGER.prototype._clone = function (data) {
    return JSON.parse(JSON.stringify(data));
};

USER_SESSION_MANAGER.prototype._normalizeBaseUrl = function (baseurl) {
    if (!baseurl) {
        return '';
    }

    baseurl = baseurl.replace(/\s+/g, '');
    baseurl = baseurl.replace(/\/+$/, '');
    return baseurl;
};

USER_SESSION_MANAGER.prototype._readStore = function () {
    var store = storage.get(this.storageKey);

    if (!store || typeof store !== 'object') {
        return this._clone(this.defaultStore);
    }

    if (!store.sessions || typeof store.sessions !== 'object') {
        store.sessions = {};
    }

    if (typeof store.activeSessionId === 'undefined') {
        store.activeSessionId = null;
    }

    return store;
};

USER_SESSION_MANAGER.prototype._writeStore = function (store) {
    storage.set(this.storageKey, store);
    return store;
};

USER_SESSION_MANAGER.prototype.getNamespace = function (sessionId) {
    return this.namespacePrefix + sessionId + ':';
};

USER_SESSION_MANAGER.prototype._buildSessionId = function (baseurl, userId) {
    var normalizedBaseurl = this._normalizeBaseUrl(baseurl).toLowerCase();
    var serverPart = btoa(normalizedBaseurl || 'server').replace(/=/g, '');
    return serverPart + ':' + userId;
};

USER_SESSION_MANAGER.prototype._normalizePinCode = function (pinCode) {
    return (pinCode || '').toString().replace(/\D/g, '').slice(0, 4);
};

USER_SESSION_MANAGER.prototype._hashPinCode = function (sessionId, pinCode) {
    var source = sessionId + '|' + this._normalizePinCode(pinCode);
    var hash = 2166136261;

    for (var i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
};

USER_SESSION_MANAGER.prototype.isValidPinCode = function (pinCode) {
    return /^\d{4}$/.test(this._normalizePinCode(pinCode));
};

USER_SESSION_MANAGER.prototype.hasPin = function (sessionOrId) {
    var session = typeof sessionOrId === 'string' ? this.getSession(sessionOrId) : sessionOrId;
    return !!(session && session.pinHash);
};

USER_SESSION_MANAGER.prototype.hasSessions = function () {
    return this.listSessions().length > 0;
};

USER_SESSION_MANAGER.prototype.listSessions = function () {
    var store = this._readStore();
    var sessions = [];

    for (var sessionId in store.sessions) {
        if (store.sessions.hasOwnProperty(sessionId)) {
            sessions.push(store.sessions[sessionId]);
        }
    }

    sessions.sort(function (left, right) {
        return (right.lastUsedAt || 0) - (left.lastUsedAt || 0);
    });

    return sessions;
};

USER_SESSION_MANAGER.prototype.getSession = function (sessionId) {
    if (!sessionId) {
        return null;
    }

    var store = this._readStore();
    return store.sessions[sessionId] || null;
};

USER_SESSION_MANAGER.prototype.getActiveSession = function () {
    var store = this._readStore();
    return this.getSession(store.activeSessionId);
};

USER_SESSION_MANAGER.prototype.setActiveSession = function (sessionId) {
    var store = this._readStore();

    if (sessionId && !store.sessions[sessionId]) {
        return null;
    }

    store.activeSessionId = sessionId || null;
    this._writeStore(store);
    return sessionId || null;
};

USER_SESSION_MANAGER.prototype.findSession = function (baseurl, userId) {
    var normalizedBaseurl = this._normalizeBaseUrl(baseurl);
    var sessions = this.listSessions();

    for (var i = 0; i < sessions.length; i++) {
        var session = sessions[i];
        if (session.userId === userId && session.baseurl === normalizedBaseurl) {
            return session;
        }
    }

    return null;
};

USER_SESSION_MANAGER.prototype.upsertSession = function (sessionData) {
    if (!sessionData || !sessionData.userId) {
        throw new Error('sessionData.userId is required');
    }

    var store = this._readStore();
    var normalizedBaseurl = this._normalizeBaseUrl(sessionData.baseurl);
    var existingSession = sessionData.id ? store.sessions[sessionData.id] : this.findSession(normalizedBaseurl, sessionData.userId);
    var sessionId = existingSession ? existingSession.id : this._buildSessionId(normalizedBaseurl, sessionData.userId);
    var lastUsedAt = sessionData.lastUsedAt || new Date().getTime();
    var session = existingSession || {
        id: sessionId,
        createdAt: lastUsedAt
    };

    session.id = sessionId;
    session.baseurl = normalizedBaseurl;
    session.hosturl = sessionData.hosturl || session.hosturl || '';
    session.serverId = sessionData.serverId || session.serverId || '';
    session.serverName = sessionData.serverName || session.serverName || '';
    session.userId = sessionData.userId;
    session.displayName = sessionData.displayName || session.displayName || sessionData.userId;
    session.accessToken = typeof sessionData.accessToken !== 'undefined' ? sessionData.accessToken : session.accessToken || null;
    session.lastUsedAt = lastUsedAt;
    session.lastError = sessionData.lastError || null;
    session.pinHash = typeof sessionData.pinHash !== 'undefined' ? sessionData.pinHash : session.pinHash || null;
    session.pinSetAt = session.pinHash ? (session.pinSetAt || lastUsedAt) : null;

    store.sessions[sessionId] = session;
    store.activeSessionId = sessionId;
    this._writeStore(store);

    return session;
};

USER_SESSION_MANAGER.prototype.invalidateSession = function (sessionId, reason) {
    var store = this._readStore();
    var session = store.sessions[sessionId];

    if (!session) {
        return null;
    }

    session.accessToken = null;
    session.lastError = reason || 'signed_out';
    session.lastUsedAt = new Date().getTime();
    store.sessions[sessionId] = session;
    this._writeStore(store);

    return session;
};

USER_SESSION_MANAGER.prototype.verifyPin = function (sessionId, pinCode) {
    var session = this.getSession(sessionId);

    if (!session || !session.pinHash) {
        return true;
    }

    if (!this.isValidPinCode(pinCode)) {
        return false;
    }

    return session.pinHash === this._hashPinCode(session.id, pinCode);
};

USER_SESSION_MANAGER.prototype.setPin = function (sessionId, pinCode) {
    var store = this._readStore();
    var session = store.sessions[sessionId];

    if (!session || !this.isValidPinCode(pinCode)) {
        return null;
    }

    session.pinHash = this._hashPinCode(session.id, pinCode);
    session.pinSetAt = new Date().getTime();
    store.sessions[sessionId] = session;
    this._writeStore(store);

    return session;
};

USER_SESSION_MANAGER.prototype.clearPin = function (sessionId) {
    var store = this._readStore();
    var session = store.sessions[sessionId];

    if (!session) {
        return null;
    }

    session.pinHash = null;
    session.pinSetAt = null;
    store.sessions[sessionId] = session;
    this._writeStore(store);

    return session;
};

USER_SESSION_MANAGER.prototype.clearSessionState = function (sessionId) {
    var namespace = this.getNamespace(sessionId);

    if (!localStorage) {
        return;
    }

    for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (key && key.indexOf(namespace) === 0) {
            localStorage.removeItem(key);
        }
    }
};

USER_SESSION_MANAGER.prototype.removeSession = function (sessionId) {
    var store = this._readStore();

    if (!store.sessions[sessionId]) {
        return false;
    }

    delete store.sessions[sessionId];

    if (store.activeSessionId === sessionId) {
        store.activeSessionId = null;
    }

    this._writeStore(store);
    this.clearSessionState(sessionId);
    return true;
};

USER_SESSION_MANAGER.prototype.buildJellyfinCredentials = function (serverData, sessionData) {
    var server = serverData || {};
    var session = sessionData || {};

    return {
        Servers: [{
            Id: server.serverId || session.serverId || '',
            Name: server.serverName || session.serverName || '',
            ManualAddress: this._normalizeBaseUrl(server.baseurl || session.baseurl || ''),
            AccessToken: session.accessToken || null,
            UserId: session.userId || null,
            DateLastAccessed: session.lastUsedAt || new Date().getTime(),
            LastConnectionMode: 2
        }]
    };
};
