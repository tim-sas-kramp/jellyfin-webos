/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var curr_req = false;
var server_info = false;
var manifest = false;

var appInfo = {
    deviceId: null,
    deviceName: 'LG Smart TV',
    appName: 'Jellyfin for WebOS',
    appVersion: '0.0.0'
};

var pendingConnectionContext = null;
var currentHandoffContext = null;
var pinDialogState = null;

var deviceInfo;
webOS.deviceInfo(function (info) {
    deviceInfo = info;
});

//Adds .includes to string to do substring matching
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';

    if (search instanceof RegExp) {
      throw TypeError('first argument must not be a RegExp');
    }
    if (start === undefined) { start = 0; }
    return this.indexOf(search, start) !== -1;
  };
}



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

function isVisible(element) {
    return !!(element && element.offsetWidth > 0 && element.offsetHeight > 0);
}

function findIndex(array, currentNode) {
    // This just implements the following function which is not available on some LG TVs.
    for (var i = 0, item; item = array[i]; i++) {
        if (currentNode.isEqualNode(item)) {
            return i;
        }
    }
}

function getNavigationScope() {
    if (isVisible(document.querySelector('#pinModal'))) {
        return document.querySelector('#pinModal');
    }

    if (isVisible(document.querySelector('#busy'))) {
        return document.querySelector('#busy');
    }

    if (isVisible(document.querySelector('#userPicker'))) {
        return document.querySelector('#userPicker');
    }

    if (isVisible(document.querySelector('#serverInfoForm'))) {
        return document.querySelector('#serverInfoForm');
    }

    return document;
}

function isLauncherNavigationActive() {
    return isVisible(document.querySelector('#pinModal'))
        || isVisible(document.querySelector('#busy'))
        || isVisible(document.querySelector('#userPicker'))
        || isVisible(document.querySelector('#serverInfoForm'));
}

function scopeContains(scope, element) {
    if (!scope || !element) {
        return false;
    }

    if (scope === document) {
        return document.documentElement.contains(element);
    }

    return scope.contains(element);
}

function getFocusableElements(scope) {
    var root = scope || getNavigationScope();
    var selector = 'input, button, a, area, object, select, textarea, [contenteditable]';

    if (root && root.id === 'userPicker') {
        selector = '.profile_button, .profile_pin, .profile_remove';
    }

    var allElements = root.querySelectorAll(selector);
    var result = [];

    for (var i = 0; i < allElements.length; i++) {
        var element = allElements[i];

        if (!isVisible(element) || element.disabled || element.tabIndex < 0) {
            continue;
        }

        result.push(element);
    }

    return result;
}

function getElementRect(element) {
    var rect = element.getBoundingClientRect();

    return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        centerX: rect.left + (rect.width / 2),
        centerY: rect.top + (rect.height / 2)
    };
}

function getDirectionalScore(currentRect, candidateRect, direction) {
    var primaryDistance;
    var secondaryDistance;
    var threshold = 2;

    switch (direction) {
        case 'left':
            if (candidateRect.centerX >= currentRect.centerX - threshold) {
                return null;
            }
            primaryDistance = currentRect.centerX - candidateRect.centerX;
            secondaryDistance = Math.abs(candidateRect.centerY - currentRect.centerY);
            break;
        case 'right':
            if (candidateRect.centerX <= currentRect.centerX + threshold) {
                return null;
            }
            primaryDistance = candidateRect.centerX - currentRect.centerX;
            secondaryDistance = Math.abs(candidateRect.centerY - currentRect.centerY);
            break;
        case 'up':
            if (candidateRect.centerY >= currentRect.centerY - threshold) {
                return null;
            }
            primaryDistance = currentRect.centerY - candidateRect.centerY;
            secondaryDistance = Math.abs(candidateRect.centerX - currentRect.centerX);
            break;
        case 'down':
            if (candidateRect.centerY <= currentRect.centerY + threshold) {
                return null;
            }
            primaryDistance = candidateRect.centerY - currentRect.centerY;
            secondaryDistance = Math.abs(candidateRect.centerX - currentRect.centerX);
            break;
        default:
            return null;
    }

    return primaryDistance * 1000 + secondaryDistance;
}

function getUserPickerRows() {
    var userPicker = document.getElementById('userPicker');
    var elements;
    var items = [];
    var rows = [];
    var rowTolerance = 24;

    if (!userPicker) {
        return rows;
    }

    elements = getFocusableElements(userPicker);

    for (var i = 0; i < elements.length; i++) {
        items.push({
            element: elements[i],
            rect: getElementRect(elements[i])
        });
    }

    items.sort(function (left, right) {
        if (Math.abs(left.rect.centerY - right.rect.centerY) > rowTolerance) {
            return left.rect.centerY - right.rect.centerY;
        }

        return left.rect.centerX - right.rect.centerX;
    });

    for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var row = rows.length ? rows[rows.length - 1] : null;

        if (!row || Math.abs(item.rect.centerY - row.centerY) > rowTolerance) {
            rows.push({
                centerY: item.rect.centerY,
                items: [item]
            });
            continue;
        }

        row.items.push(item);
    }

    for (var k = 0; k < rows.length; k++) {
        rows[k].items.sort(function (left, right) {
            return left.rect.centerX - right.rect.centerX;
        });
    }

    return rows;
}

function findUserPickerItem(rows, element) {
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        for (var itemIndex = 0; itemIndex < rows[rowIndex].items.length; itemIndex++) {
            if (rows[rowIndex].items[itemIndex].element === element) {
                return {
                    rowIndex: rowIndex,
                    itemIndex: itemIndex,
                    item: rows[rowIndex].items[itemIndex]
                };
            }
        }
    }

    return null;
}

function getClosestUserPickerItem(row, centerX, maxDistance) {
    var bestItem = null;
    var bestDistance = Number.POSITIVE_INFINITY;

    if (!row) {
        return null;
    }

    for (var i = 0; i < row.items.length; i++) {
        var distance = Math.abs(row.items[i].rect.centerX - centerX);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestItem = row.items[i];
        }
    }

    if (bestItem && bestDistance <= maxDistance) {
        return bestItem;
    }

    return null;
}

function navigateUserPicker(direction, currentElement) {
    var rows = getUserPickerRows();
    var current = findUserPickerItem(rows, currentElement);
    var targetRow;
    var targetItem;
    var maxDistance;

    if (!rows.length) {
        return false;
    }

    if (!current) {
        rows[0].items[0].element.focus();
        return true;
    }

    if (direction === 'left') {
        targetItem = rows[current.rowIndex].items[current.itemIndex - 1];
        if (targetItem) {
            targetItem.element.focus();
        }
        return true;
    }

    if (direction === 'right') {
        targetItem = rows[current.rowIndex].items[current.itemIndex + 1];
        if (targetItem) {
            targetItem.element.focus();
        }
        return true;
    }

    targetRow = rows[current.rowIndex + (direction === 'down' ? 1 : -1)];
    maxDistance = Math.max(current.item.element.offsetWidth * 0.6, 80);
    targetItem = getClosestUserPickerItem(targetRow, current.item.rect.centerX, maxDistance);

    if (targetItem) {
        targetItem.element.focus();
    }

    return true;
}

function navigate(direction) {
    var scope = getNavigationScope();
    var allElements = getFocusableElements(scope);
    var element = document.activeElement;

    if (!allElements.length) {
        return;
    }

    if (!element || !scopeContains(scope, element) || !isVisible(element) || element.tagName == 'BODY') {
        allElements[0].focus();
        return;
    }

    if (scope && scope.id === 'userPicker') {
        navigateUserPicker(direction, element);
        return;
    }

    var currentRect = getElementRect(element);
    var bestCandidate = null;
    var bestScore = Number.POSITIVE_INFINITY;

    for (var i = 0; i < allElements.length; i++) {
        var candidate = allElements[i];

        if (candidate === element) {
            continue;
        }

        var score = getDirectionalScore(currentRect, getElementRect(candidate), direction);

        if (score !== null && score < bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    if (bestCandidate) {
        bestCandidate.focus();
    }
}

function upArrowPressed() {
    navigate('up');
}

function downArrowPressed() {
    navigate('down');
}

function leftArrowPressed() {
    navigate('left');
}

function rightArrowPressed() {
    navigate('right');
}

function getRemoteDigit(evt) {
    var key = evt.key;

    if (key && /^\d$/.test(key)) {
        return key;
    }

    if (evt.keyCode >= 48 && evt.keyCode <= 57) {
        return (evt.keyCode - 48).toString();
    }

    if (evt.keyCode >= 96 && evt.keyCode <= 105) {
        return (evt.keyCode - 96).toString();
    }

    return null;
}

function isPinInput(element) {
    return !!(element && /^(pinCurrent|pinNew|pinConfirm)$/.test(element.id));
}

function getVisiblePinInputs() {
    var pinInputIds = ['pinCurrent', 'pinNew', 'pinConfirm'];
    var inputs = [];

    for (var i = 0; i < pinInputIds.length; i++) {
        var input = document.getElementById(pinInputIds[i]);

        if (isVisible(input)) {
            inputs.push(input);
        }
    }

    return inputs;
}

function getPreferredPinInput() {
    var inputs = getVisiblePinInputs();
    var activeElement = document.activeElement;
    var activeIndex;

    if (!inputs.length) {
        return null;
    }

    if (isPinInput(activeElement) && isVisible(activeElement) && activeElement.value.length < 4) {
        return activeElement;
    }

    if (isPinInput(activeElement) && isVisible(activeElement)) {
        activeIndex = findIndex(inputs, activeElement);
        if (typeof activeIndex !== 'undefined' && inputs[activeIndex + 1]) {
            return inputs[activeIndex + 1];
        }
    }

    for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].value.length < 4) {
            return inputs[i];
        }
    }

    return isPinInput(activeElement) && isVisible(activeElement) ? activeElement : inputs[inputs.length - 1];
}

function handlePinDigitKey(evt) {
    if (!isVisible(document.querySelector('#pinModal'))) {
        return false;
    }

    var digit = getRemoteDigit(evt);
    var input = getPreferredPinInput();

    if (digit === null || !input || input.value.length >= 4) {
        return false;
    }

    input.value = userSessionManager._normalizePinCode(input.value + digit);
    setPinDialogError('');

    if (input.value.length === 4) {
        var inputs = getVisiblePinInputs();
        var inputIndex = findIndex(inputs, input);
        var nextInput = typeof inputIndex !== 'undefined' ? inputs[inputIndex + 1] : null;

        if (nextInput) {
            nextInput.focus();
        } else if (pinDialogState && pinDialogState.mode === 'unlock') {
            submitPinDialog();
        } else {
            document.getElementById('pinPrimary').focus();
        }
    }

    return true;
}

function handlePinDeleteKey(evt) {
    if (!isVisible(document.querySelector('#pinModal'))) {
        return false;
    }

    if (!(evt.key === 'Backspace' || evt.key === 'Delete' || evt.keyCode == 8 || evt.keyCode == 46)) {
        return false;
    }

    var inputs = getVisiblePinInputs();
    var input = document.activeElement;
    var inputIndex;

    if (!inputs.length) {
        return false;
    }

    if (!isPinInput(input) || !isVisible(input)) {
        input = inputs[inputs.length - 1];
    }

    if (!input.value.length) {
        inputIndex = findIndex(inputs, input);
        if (typeof inputIndex !== 'undefined' && inputIndex > 0) {
            input = inputs[inputIndex - 1];
            input.focus();
        }
    }

    input.value = input.value.slice(0, -1);
    setPinDialogError('');
    return true;
}

function backPressed() {
    if (isVisible(document.querySelector('#pinModal'))) {
        cancelPinDialog();
        return;
    }

    if (isVisible(document.querySelector('#backToUsers'))) {
        showUserPicker();
        return;
    }

    webOS.platformBack();
}

document.onkeydown = function (evt) {
    evt = evt || window.event;

    if (!isLauncherNavigationActive()) {
        return;
    }

    if (handlePinDigitKey(evt) || handlePinDeleteKey(evt)) {
        if (evt.preventDefault) {
            evt.preventDefault();
        }
        return false;
    }

    switch (evt.keyCode) {
        case 37:
            leftArrowPressed();
            break;
        case 39:
            rightArrowPressed();
            break;
        case 38:
            upArrowPressed();
            break;
        case 40:
            downArrowPressed();
            break;
        case 461: // Back
            backPressed();
            break;
        default:
            return;
    }

    if (evt.preventDefault) {
        evt.preventDefault();
    }

    return false;
};

function navigationInit() {
    var allElements = getFocusableElements();

    for (var i = 0; i < allElements.length; i++) {
        allElements[i].focus();
        return;
    }
}

function setPinDialogError(message) {
    var errorElem = document.querySelector('#pinDialogError');

    if (!message) {
        errorElem.style.display = 'none';
        errorElem.innerHTML = '&nbsp;';
        return;
    }

    errorElem.style.display = '';
    errorElem.innerText = message;
}

function resetPinDialogFields() {
    document.querySelector('#pinCurrent').value = '';
    document.querySelector('#pinNew').value = '';
    document.querySelector('#pinConfirm').value = '';
    setPinDialogError('');
}

function getPinInputValue(selector) {
    return userSessionManager._normalizePinCode(document.querySelector(selector).value);
}

function closePinDialog() {
    pinDialogState = null;
    document.querySelector('#pinModal').style.display = 'none';
    resetPinDialogFields();

    if (userSessionManager.hasSessions()) {
        navigationInit();
    }
}

function cancelPinDialog() {
    closePinDialog();
}

function showPinDialog() {
    document.querySelector('#pinModal').style.display = '';
    setPinDialogError('');
    navigationInit();
}

function openUnlockPinDialog(sessionId, onSuccess) {
    var session = userSessionManager.getSession(sessionId);

    if (!session) {
        return;
    }

    pinDialogState = {
        mode: 'unlock',
        sessionId: sessionId,
        onSuccess: onSuccess
    };

    document.querySelector('#pinDialogTitle').innerText = 'Enter PIN';
    document.querySelector('#pinDialogMessage').innerText = 'Enter the 4-digit PIN for ' + session.displayName + '.';
    document.querySelector('#pinCurrentGroup').style.display = '';
    document.querySelector('#pinNewGroup').style.display = 'none';
    document.querySelector('#pinConfirmGroup').style.display = 'none';
    document.querySelector('#pinCurrent').placeholder = '4-digit PIN';
    document.querySelector('#pinPrimary').innerText = 'Unlock';
    document.querySelector('#pinRemove').style.display = 'none';
    resetPinDialogFields();
    showPinDialog();
}

function openManagePinDialog(sessionId) {
    var session = userSessionManager.getSession(sessionId);

    if (!session) {
        return;
    }

    pinDialogState = {
        mode: 'manage',
        sessionId: sessionId
    };

    document.querySelector('#pinDialogTitle').innerText = userSessionManager.hasPin(session)
        ? 'Manage PIN'
        : 'Set PIN';
    document.querySelector('#pinDialogMessage').innerText = userSessionManager.hasPin(session)
        ? 'Change or remove the 4-digit PIN for ' + session.displayName + '.'
        : 'Protect ' + session.displayName + ' with a 4-digit PIN.';
    document.querySelector('#pinCurrentGroup').style.display = userSessionManager.hasPin(session) ? '' : 'none';
    document.querySelector('#pinNewGroup').style.display = '';
    document.querySelector('#pinConfirmGroup').style.display = '';
    document.querySelector('#pinCurrent').placeholder = 'Current PIN';
    document.querySelector('#pinPrimary').innerText = userSessionManager.hasPin(session)
        ? 'Change PIN'
        : 'Save PIN';
    document.querySelector('#pinRemove').style.display = userSessionManager.hasPin(session) ? '' : 'none';
    resetPinDialogFields();
    showPinDialog();
}

function submitPinDialog() {
    if (!pinDialogState) {
        return;
    }

    var session = userSessionManager.getSession(pinDialogState.sessionId);

    if (!session) {
        closePinDialog();
        return;
    }

    if (pinDialogState.mode === 'unlock') {
        var unlockPin = getPinInputValue('#pinCurrent');

        if (!userSessionManager.verifyPin(session.id, unlockPin)) {
            setPinDialogError('Incorrect PIN.');
            document.querySelector('#pinCurrent').value = '';
            document.querySelector('#pinCurrent').focus();
            return;
        }

        var successCallback = pinDialogState.onSuccess;
        closePinDialog();

        if (typeof successCallback === 'function') {
            successCallback();
        }
        return;
    }

    var currentPin = getPinInputValue('#pinCurrent');
    var newPin = getPinInputValue('#pinNew');
    var confirmPin = getPinInputValue('#pinConfirm');

    if (userSessionManager.hasPin(session) && !userSessionManager.verifyPin(session.id, currentPin)) {
        setPinDialogError('Current PIN is incorrect.');
        return;
    }

    if (!userSessionManager.isValidPinCode(newPin)) {
        setPinDialogError('PIN must be exactly 4 digits.');
        return;
    }

    if (newPin !== confirmPin) {
        setPinDialogError('PIN entries do not match.');
        return;
    }

    userSessionManager.setPin(session.id, newPin);
    closePinDialog();
    renderSessionList();
}

function removeSessionPinFromDialog() {
    if (!pinDialogState || pinDialogState.mode !== 'manage') {
        return;
    }

    var session = userSessionManager.getSession(pinDialogState.sessionId);
    if (!session || !userSessionManager.hasPin(session)) {
        closePinDialog();
        return;
    }

    var currentPin = getPinInputValue('#pinCurrent');
    if (!userSessionManager.verifyPin(session.id, currentPin)) {
        setPinDialogError('Current PIN is incorrect.');
        return;
    }

    userSessionManager.clearPin(session.id);
    closePinDialog();
    renderSessionList();
}

window.cancelPinDialog = cancelPinDialog;
window.submitPinDialog = submitPinDialog;
window.removeSessionPinFromDialog = removeSessionPinFromDialog;

function getSessionStatusText(session) {
    if (session.lastError === 'server_changed') {
        return 'Server changed, sign in again';
    }

    if (session.lastError === 'signed_out') {
        return 'Signed out';
    }

    if (userSessionManager.hasPin(session)) {
        return 'PIN protected';
    }

    if (session.accessToken) {
        return 'Ready to watch';
    }

    return 'Sign in again';
}

function getSessionServerLabel(session) {
    if (session && session.serverName) {
        return session.serverName;
    }

    if (session && session.baseurl) {
        try {
            return new URL(session.baseurl).hostname || 'Jellyfin Server';
        } catch (error) {
            return session.baseurl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'Jellyfin Server';
        }
    }

    return 'Jellyfin Server';
}

function getProfileInitials(name) {
    var parts = (name || '?').replace(/\s+/g, ' ').trim().split(' ');
    var initials = '';

    for (var i = 0; i < parts.length && initials.length < 2; i++) {
        if (parts[i]) {
            initials += parts[i].charAt(0);
        }
    }

    if (!initials) {
        initials = (name || '?').charAt(0) || '?';
    }

    return initials.toUpperCase();
}

function renderSessionList() {
    var userlist = document.getElementById('userlist');
    var sessionMessage = document.getElementById('sessionMessage');
    var sessions = userSessionManager.listSessions();

    userlist.innerHTML = '';

    if (!sessions.length) {
        sessionMessage.innerText = 'No saved profiles yet. Add an account to get started.';
        return;
    }

    sessionMessage.innerText = 'Choose a profile or add another account.';

    for (var i = 0; i < sessions.length; i++) {
        var session = sessions[i];
        var sessionCard = document.createElement('li');
        sessionCard.className = 'user_card' + (userSessionManager.hasPin(session) ? ' user_card_locked' : '');

        var openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'profile_button';
        openButton.onclick = (function (sessionId) {
            return function () {
                connectWithSession(sessionId);
            };
        })(session.id);

        var avatar = document.createElement('div');
        avatar.className = 'profile_avatar';
        avatar.innerText = getProfileInitials(session.displayName);

        if (userSessionManager.hasPin(session)) {
            var pinBadge = document.createElement('div');
            pinBadge.className = 'profile_badge';
            pinBadge.innerText = 'PIN';
            avatar.appendChild(pinBadge);
        }

        openButton.appendChild(avatar);

        var meta = document.createElement('div');
        meta.className = 'user_card_meta';

        var name = document.createElement('div');
        name.className = 'user_card_name';
        name.innerText = session.displayName;
        meta.appendChild(name);

        var server = document.createElement('div');
        server.className = 'user_card_server';
        server.innerText = getSessionServerLabel(session);
        meta.appendChild(server);

        var status = document.createElement('div');
        status.className = 'user_card_status' + (session.accessToken ? '' : ' user_card_status_error');
        status.innerText = getSessionStatusText(session);
        meta.appendChild(status);

        openButton.appendChild(meta);
        sessionCard.appendChild(openButton);

        var actions = document.createElement('div');
        actions.className = 'user_card_actions';

        var pinButton = document.createElement('button');
        pinButton.type = 'button';
        pinButton.className = 'profile_pin';
        pinButton.innerText = userSessionManager.hasPin(session) ? 'Edit PIN' : 'Set PIN';
        pinButton.onclick = (function (sessionId) {
            return function () {
                openManagePinDialog(sessionId);
            };
        })(session.id);
        actions.appendChild(pinButton);

        var removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'profile_remove';
        removeButton.innerText = 'Remove';
        removeButton.onclick = (function (sessionId) {
            return function () {
                removeUserSession(sessionId);
            };
        })(session.id);
        actions.appendChild(removeButton);

        sessionCard.appendChild(actions);
        userlist.appendChild(sessionCard);
    }

    var addCard = document.createElement('li');
    addCard.className = 'user_card user_card_add';

    var addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'profile_button';
    addButton.onclick = showAddAccountForm;

    var addAvatar = document.createElement('div');
    addAvatar.className = 'profile_avatar profile_avatar_add';
    addAvatar.innerText = '+';
    addButton.appendChild(addAvatar);

    var addMeta = document.createElement('div');
    addMeta.className = 'user_card_meta';

    var addName = document.createElement('div');
    addName.className = 'user_card_name';
    addName.innerText = 'Add account';
    addMeta.appendChild(addName);

    var addServer = document.createElement('div');
    addServer.className = 'user_card_server';
    addServer.innerText = 'Connect another Jellyfin user';
    addMeta.appendChild(addServer);

    addButton.appendChild(addMeta);
    addCard.appendChild(addButton);
    userlist.appendChild(addCard);
}

function showContainer() {
    document.querySelector('.container').style.display = '';
}

function resetEmbeddedApp() {
    var contentFrame = document.querySelector('#contentFrame');
    currentHandoffContext = null;
    contentFrame.style.display = 'none';
    contentFrame.src = 'about:blank';
}

function showServerForm(showBackButton) {
    showContainer();
    startDiscovery();
    document.querySelector('#userPicker').style.display = 'none';
    document.querySelector('#serverInfoForm').style.display = '';
    document.querySelector('#busy').style.display = 'none';
    document.querySelector('#backToUsers').style.display = showBackButton || (showBackButton !== false && userSessionManager.hasSessions()) ? '' : 'none';
    navigationInit();
}

function showUserPicker() {
    if (!userSessionManager.hasSessions()) {
        showServerForm(false);
        return;
    }

    resetEmbeddedApp();
    showContainer();
    stopDiscovery();
    renderSessionList();
    hideError();
    document.querySelector('#busy').style.display = 'none';
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#userPicker').style.display = '';
    navigationInit();
}

function showAddAccountForm() {
    pendingConnectionContext = null;
    resetEmbeddedApp();
    hideError();
    showServerForm(true);
}

window.showUserPicker = showUserPicker;
window.showAddAccountForm = showAddAccountForm;

function connectWithSessionUnlocked(sessionId) {
    var session = userSessionManager.getSession(sessionId);

    if (!session) {
        showUserPicker();
        return;
    }

    userSessionManager.setActiveSession(sessionId);
    document.querySelector('#baseurl').value = session.baseurl;
    handleServerSelect({
        sessionId: sessionId,
        mode: 'session'
    });
}

function connectWithSession(sessionId) {
    var session = userSessionManager.getSession(sessionId);

    if (!session) {
        showUserPicker();
        return;
    }

    if (userSessionManager.hasPin(session)) {
        openUnlockPinDialog(sessionId, function () {
            connectWithSessionUnlocked(sessionId);
        });
        return;
    }

    connectWithSessionUnlocked(sessionId);
}

function removeUserSessionUnlocked(sessionId) {
    userSessionManager.removeSession(sessionId);
    renderSessionList();

    if (userSessionManager.hasSessions()) {
        showUserPicker();
    } else {
        showServerForm(false);
    }
}

function removeUserSession(sessionId) {
    var session = userSessionManager.getSession(sessionId);

    if (session && userSessionManager.hasPin(session)) {
        openUnlockPinDialog(sessionId, function () {
            removeUserSessionUnlocked(sessionId);
        });
        return;
    }

    removeUserSessionUnlocked(sessionId);
}

function handleCheckbox(elem, evt) {
    console.log(elem);
    if (evt === true) {
        return true; // webos should be capable of toggling the checkbox by itself
    } else {
        evt = evt || window.event; //keydown event
        if (evt.keyCode == 13 || evt.keyCode == 32) { //OK button or Space
            elem.checked = !elem.checked;
        }
    }
    return false;
}

// Similar to jellyfin-web
function generateDeviceId() {
    return btoa([navigator.userAgent, new Date().getTime()].join('|')).replace(/=/g, '1');
}

function getDeviceId() {
    // Use variable '_deviceId2' to mimic jellyfin-web

    var deviceId = storage.get('_deviceId2');

    if (!deviceId) {
        deviceId = generateDeviceId();
        storage.set('_deviceId2', deviceId);
    }

    return deviceId;
}


function loadStoredServers() {
    if (!storage.exists('connected_servers')) {
        return null;
    }

    connected_servers = storage.get('connected_servers');
    if (!connected_servers || !Object.keys(connected_servers).length) {
        return null;
    }

    var first_server = connected_servers[Object.keys(connected_servers)[0]];
    document.querySelector('#baseurl').value = first_server.baseurl;
    document.querySelector('#auto_connect').checked = first_server.auto_connect;
    renderServerList(connected_servers);
    return first_server;
}

function Init() {
    appInfo.deviceId = getDeviceId();

    webOS.fetchAppInfo(function (info) {
        if (info) {
            appInfo.appVersion = info.version;
        } else {
            console.error('Error occurs while getting appinfo.json.');
        }
    });

    var first_server = loadStoredServers();
    var sessions = userSessionManager.listSessions();
    renderSessionList();
    navigationInit();

    if (sessions.length > 0) {
        showUserPicker();
        return;
    }

    showServerForm(false);

    if (first_server && !(window.performance && window.performance.navigation.type == window.performance.navigation.TYPE_BACK_FORWARD) && first_server.auto_connect) {
        console.log('Auto connecting...');
        handleServerSelect({ mode: 'first-time' });
    }
}
// Just ensure that the string has no spaces, and begins with either http:// or https:// (case insensitively), and isn't empty after the ://
function validURL(str) {
    pattern = /^https?:\/\/\S+$/i;
    return !!pattern.test(str);
}

function normalizeUrl(url) {
    url = url.trimLeft ? url.trimLeft() : url.trimStart();
    if (url.indexOf("http://") != 0 && url.indexOf("https://") != 0) {
        // assume http
        url = "http://" + url;
    }
    // normalize multiple slashes as this trips WebOS in some cases
    var parts = url.split("://");
    for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        while (true) {
            var newpart = part.replace("//", "/");
            if (newpart.length == part.length) break;
            part = newpart;
        }
        parts[i] = part;
    }
    return parts.join("://");
}

function handleServerSelect(options) {
    options = options || {};

    var baseurl = normalizeUrl(options.baseurl || document.querySelector('#baseurl').value);
    var auto_connect = typeof options.auto_connect === 'boolean' ? options.auto_connect : document.querySelector('#auto_connect').checked;

    if (validURL(baseurl)) {
        pendingConnectionContext = {
            mode: options.mode || 'add-account',
            sessionId: options.sessionId || null,
            baseurl: baseurl
        };

        displayConnecting();
        console.log(baseurl, auto_connect);

        if (curr_req) {
            console.log("There is an active request.");
            abort();
        }
        hideError();
        getServerInfo(baseurl, auto_connect);
    } else {
        console.log(baseurl);
        displayError("Please enter a valid URL, it needs a scheme (http:// or https://), a hostname or IP (ex. jellyfin.local or 192.168.0.2) and a port (ex. :8096 or :8920).");
    }
}

function displayError(error) {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = '';
    errorElem.innerHTML = error;
}
function hideError() {
    var errorElem = document.querySelector('#error')
    errorElem.style.display = 'none';
    errorElem.innerHTML = '&nbsp;';
}

function displayConnecting() {
    if (pendingConnectionContext) {
        pendingConnectionContext.previousView = isVisible(document.querySelector('#userPicker')) ? 'userPicker' : 'serverForm';
    }

    document.querySelector('#userPicker').style.display = 'none';
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#busy').style.display = '';
    navigationInit();
}
function hideConnecting() {
    document.querySelector('#busy').style.display = 'none';

    if (pendingConnectionContext && pendingConnectionContext.previousView === 'userPicker' && userSessionManager.hasSessions()) {
        document.querySelector('#userPicker').style.display = '';
        document.querySelector('#serverInfoForm').style.display = 'none';
    } else {
        document.querySelector('#serverInfoForm').style.display = '';
        document.querySelector('#userPicker').style.display = 'none';
    }

    navigationInit();
}
function getServerInfo(baseurl, auto_connect) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            handleSuccessServerInfo(data, baseurl, auto_connect);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getManifest(baseurl) {
    curr_req = ajax.request(normalizeUrl(baseurl + "/web/manifest.json"), {
        method: "GET",
        success: function (data) {
            handleSuccessManifest(data, baseurl);
        },
        error: handleFailure,
        abort: handleAbort,
        timeout: 5000
    });
}

function getConnectedServers() {
    connected_servers = storage.get('connected_servers');
    if (!connected_servers) {
        connected_servers = {};
    }
    return connected_servers;
}


function handleSuccessServerInfo(data, baseurl, auto_connect) {
    curr_req = false;

    connected_servers = getConnectedServers();
    for (var server_id in connected_servers) {
        var server = connected_servers[server_id]
        if (server.baseurl == baseurl) {
            if (server.id != data.Id && server.id !== false) {
                //server has changed warn user.
                hideConnecting();
                displayError("The server ID has changed since the last connection, please check if you are reaching your own server. To connect anyway, click connect again.");
                delete connected_servers[server_id]
                connected_servers[data.Id] = ({ 'baseurl': baseurl, 'auto_connect': false, 'id': false })
                storage.set('connected_server', connected_servers)
                return false
            }
        }
    }


    connected_servers = lruStrategy(connected_servers,4, { 'baseurl': baseurl, 'auto_connect': auto_connect, 'id': data.Id, 'Name':data.ServerName })

    storage.set('connected_servers', connected_servers);

    if (pendingConnectionContext) {
        pendingConnectionContext.server = {
            baseurl: baseurl,
            serverId: data.Id,
            serverName: data.ServerName
        };

        if (pendingConnectionContext.sessionId) {
            var existingSession = userSessionManager.getSession(pendingConnectionContext.sessionId);

            if (existingSession) {
                userSessionManager.upsertSession({
                    id: existingSession.id,
                    baseurl: baseurl,
                    hosturl: existingSession.hosturl,
                    serverId: data.Id,
                    serverName: data.ServerName,
                    userId: existingSession.userId,
                    displayName: existingSession.displayName,
                    accessToken: existingSession.serverId && existingSession.serverId !== data.Id ? null : existingSession.accessToken,
                    lastError: existingSession.serverId && existingSession.serverId !== data.Id ? 'server_changed' : null
                });
            }
        }
    }


    getManifest(baseurl)
    return true;
}

function lruStrategy(old_items,max_items,new_item) {
    var result = {}
    var id = new_item.id

    delete old_items[id] // LRU: re-insert entry (in front) each time it is used
    result[id] =  new_item
    var keys = Object.keys(old_items)
    for (var i=0; i<max_items-1; i++){
        var current_key=keys[i]
        result[current_key] = old_items[current_key]
    }
    return result
}

function handleSuccessManifest(data, baseurl) {
    if(data.start_url.includes("/web")){
        var hosturl = normalizeUrl(baseurl + "/" + data.start_url);
    } else {
        var hosturl = normalizeUrl(baseurl + "/web/" + data.start_url);
    }

    curr_req = false;

    for (var server_id in connected_servers) {
        var info = connected_servers[server_id]
        if (info['baseurl' ] == baseurl) {
            info['hosturl'] = hosturl
            info['Address'] = info['Address'] || baseurl

            storage.set('connected_servers', connected_servers)
            console.log("martin:handleSuccessManifest modified server");
            console.log(info);

            if (pendingConnectionContext) {
                pendingConnectionContext.server = pendingConnectionContext.server || {};
                pendingConnectionContext.server.baseurl = baseurl;
                pendingConnectionContext.server.hosturl = hosturl;

                if (pendingConnectionContext.sessionId) {
                    var session = userSessionManager.getSession(pendingConnectionContext.sessionId);
                    if (session) {
                        userSessionManager.upsertSession({
                            id: session.id,
                            baseurl: baseurl,
                            hosturl: hosturl,
                            serverId: pendingConnectionContext.server.serverId || session.serverId,
                            serverName: pendingConnectionContext.server.serverName || session.serverName,
                            userId: session.userId,
                            displayName: session.displayName,
                            accessToken: session.accessToken,
                            lastError: session.lastError
                        });
                    }
                }
            }

        // avoid Promise as it's buggy in some WebOS
            getTextToInject(function (bundle) {
                handoff(hosturl, bundle);
            }, function (error) {
                console.error(error);
                showLauncherAfterConnectionError(error);
                curr_req = false;
            });
            return;
        }
    }

    connected_servers[baseurl] = {
        'baseurl': baseurl,
        'hosturl': hosturl,
        'Name': (pendingConnectionContext && pendingConnectionContext.server && pendingConnectionContext.server.serverName) || 'Jellyfin Server',
        'Address': new URL(baseurl).hostname.slice(0, 8)
    };
    storage.set('connected_servers', connected_servers);

    getTextToInject(function (bundle) {
        handoff(hosturl, bundle);
    }, function (error) {
        console.error(error);
        showLauncherAfterConnectionError(error);
        curr_req = false;
    });
}

function showLauncherAfterConnectionError(errorMessage) {
    var shouldShowUserPicker = pendingConnectionContext && pendingConnectionContext.mode === 'session' && userSessionManager.hasSessions();
    pendingConnectionContext = null;

    if (shouldShowUserPicker) {
        showUserPicker();
    } else {
        showServerForm(userSessionManager.hasSessions());
    }

    if (errorMessage) {
        displayError(errorMessage);
    }
}

function handleAbort() {
    console.log("Aborted.")
    curr_req = false;
    showLauncherAfterConnectionError();
}

function handleFailure(data) {
    console.log("Failure:", data)
    console.log("Could not connect to server...")
    var errorMessage;

    if (data.error == 'timeout') {
        errorMessage = "The request timed out.";
    } else if (data.error == 'abort') {
        errorMessage = "The request was aborted.";
    } else if (typeof data.error === 'string') {
        errorMessage = data.error;
    } else if (typeof data.error === 'number' && data.error > 0) {
        errorMessage = "Got HTTP error " + data.error.toString() + " from server, are you connecting to a Jellyfin Server?";
    } else {
        errorMessage = "Unknown error occured, are you connecting to a Jellyfin Server?";
    }

    showLauncherAfterConnectionError(errorMessage);
    storage.remove('connected_server');
    curr_req = false;
}

function abort() {
    if (curr_req) {
        curr_req.abort()
    } else {
        showLauncherAfterConnectionError();
    }
    console.log("Aborting...");
}


function loadUrl(url, success, failure) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', url);

    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 400) {
            success(xhr.responseText);
        } else {
            failure("Failed to load '" + url + "' (HTTP " + xhr.status.toString() + ")");
        }
    };

    xhr.onerror = function () {
        failure("Failed to load '" + url + "'");
    };

    xhr.send();
}

function getTextToInject(success, failure) {
    var bundle = {};

    var urls = ['js/multiUser.js', 'js/webOS.js', 'css/webOS.css'];

    // imitate promises as they're borked in at least WebOS 2
    var looper = function (idx) {
        if (idx >= urls.length) {
            success(bundle);
        } else {
            var url = urls[idx];
            var ext = url.split('.').pop();
            loadUrl(url, function (data) {
                bundle[ext] = (bundle[ext] || '') + data;
                looper(idx + 1);
            }, failure);
        }
    };
    looper(0);
}

function escapeInlineText(text, closingTag) {
    return text.replace(new RegExp('</' + closingTag, 'gi'), '<\\/' + closingTag);
}

function escapeHtmlAttribute(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function stripHash(url) {
    return url.split('#')[0];
}

function getUrlHash(url) {
    var parts = url.split('#');
    if (parts.length < 2) {
        return '';
    }

    return '#' + parts.slice(1).join('#');
}

function getBaseHref(url) {
    var strippedUrl = stripHash(url);
    return strippedUrl.substring(0, strippedUrl.lastIndexOf('/') + 1);
}

function buildHandoffContext(url) {
    var server = pendingConnectionContext && pendingConnectionContext.server ? pendingConnectionContext.server : {
        baseurl: pendingConnectionContext ? pendingConnectionContext.baseurl : stripHash(url),
        hosturl: url,
        serverId: '',
        serverName: ''
    };
    var session = pendingConnectionContext && pendingConnectionContext.sessionId ? userSessionManager.getSession(pendingConnectionContext.sessionId) : null;

    if (session) {
        session = userSessionManager.upsertSession({
            id: session.id,
            baseurl: server.baseurl,
            hosturl: server.hosturl || url,
            serverId: server.serverId || session.serverId,
            serverName: server.serverName || session.serverName,
            userId: session.userId,
            displayName: session.displayName,
            accessToken: session.accessToken,
            lastError: session.lastError
        });
    }

    return {
        enabled: true,
        server: {
            baseurl: server.baseurl,
            hosturl: server.hosturl || url,
            serverId: server.serverId || '',
            serverName: server.serverName || ''
        },
        activeSession: session ? {
            id: session.id,
            namespace: userSessionManager.getNamespace(session.id),
            baseurl: session.baseurl,
            hosturl: session.hosturl || url,
            serverId: session.serverId,
            serverName: session.serverName,
            userId: session.userId,
            displayName: session.displayName,
            accessToken: session.accessToken,
            lastError: session.lastError
        } : null,
        jellyfinCredentials: userSessionManager.buildJellyfinCredentials(server, session || {}),
        initialHash: getUrlHash(url)
    };
}

function createProxyHtml(html, url, bundle, handoffContext) {
    var injectedAppInfo = {
        deviceId: appInfo.deviceId,
        deviceName: appInfo.deviceName,
        appName: appInfo.appName,
        appVersion: appInfo.appVersion,
        multiUser: handoffContext
    };

    var injectedHead = ''
        + '<base href="' + escapeHtmlAttribute(getBaseHref(url)) + '">'
        + '<script>window.AppInfo = ' + JSON.stringify(injectedAppInfo) + ';window.DeviceInfo = ' + JSON.stringify(deviceInfo) + ';</script>'
        + (bundle.js ? '<script>' + escapeInlineText(bundle.js, 'script') + '</script>' : '')
        + (bundle.css ? '<style>' + escapeInlineText(bundle.css, 'style') + '</style>' : '');

    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head([^>]*)>/i, function (_match, attributes) {
            return '<head' + attributes + '>' + injectedHead;
        });
    }

    return '<head>' + injectedHead + '</head>' + html;
}

function writeProxyDocument(html, success, failure) {
    var contentFrame = document.querySelector('#contentFrame');
    var attempts = 0;
    var timer = setInterval(function () {
        attempts++;

        try {
            var iframeDocument = contentFrame.contentWindow.document;
            clearInterval(timer);
            iframeDocument.open();
            iframeDocument.write(html);
            iframeDocument.close();
            success();
        } catch (error) {
            if (attempts >= 400) {
                clearInterval(timer);
                failure(error.toString());
            }
        }
    }, 0);
}

function handoff(url, bundle) {
    console.log('Handoff called with: ', url);

    stopDiscovery();
    document.querySelector('.container').style.display = 'none';

    var contentFrame = document.querySelector('#contentFrame');
    contentFrame.style.display = '';
    document.querySelector('#busy').style.display = 'none';

    currentHandoffContext = buildHandoffContext(url);

    loadUrl(stripHash(url), function (html) {
        var proxiedHtml = createProxyHtml(html, url, bundle, currentHandoffContext);
        contentFrame.src = 'about:blank';
        writeProxyDocument(proxiedHtml, function () {
            pendingConnectionContext = null;
        }, function (error) {
            console.error(error);
            currentHandoffContext = null;
            showLauncherAfterConnectionError(error);
        });
    }, function (error) {
        console.error(error);
        currentHandoffContext = null;
        showLauncherAfterConnectionError(error);
    });
}

function handleEmbeddedSignIn(data) {
    if (!data || !data.userId) {
        return;
    }

    var serverContext = currentHandoffContext ? currentHandoffContext.server : {};
    var activeSession = currentHandoffContext ? currentHandoffContext.activeSession : null;
    var session = userSessionManager.upsertSession({
        id: activeSession ? activeSession.id : null,
        baseurl: data.baseurl || serverContext.baseurl,
        hosturl: data.hosturl || serverContext.hosturl,
        serverId: data.serverId || serverContext.serverId,
        serverName: data.serverName || serverContext.serverName,
        userId: data.userId,
        displayName: data.displayName,
        accessToken: data.accessToken,
        lastError: null
    });

    if (currentHandoffContext) {
        currentHandoffContext.activeSession = {
            id: session.id,
            namespace: userSessionManager.getNamespace(session.id),
            baseurl: session.baseurl,
            hosturl: session.hosturl,
            serverId: session.serverId,
            serverName: session.serverName,
            userId: session.userId,
            displayName: session.displayName,
            accessToken: session.accessToken,
            lastError: null
        };
    }

    renderSessionList();
}

function handleEmbeddedSignOut() {
    var session = currentHandoffContext && currentHandoffContext.activeSession
        ? userSessionManager.getSession(currentHandoffContext.activeSession.id)
        : userSessionManager.getActiveSession();

    if (!session) {
        return;
    }

    userSessionManager.invalidateSession(session.id, 'signed_out');

    if (currentHandoffContext && currentHandoffContext.activeSession) {
        currentHandoffContext.activeSession.accessToken = null;
        currentHandoffContext.activeSession.lastError = 'signed_out';
    }

    renderSessionList();
}

window.addEventListener('message', function (event) {
    var msg = event.data || {};

    switch (msg.type) {
        case 'selectServer':
        case 'multiUser.openSwitcher':
            showUserPicker();
            break;
        case 'multiUser.signedIn':
            handleEmbeddedSignIn(msg.data || {});
            break;
        case 'multiUser.signedOut':
            handleEmbeddedSignOut();
            break;
        case 'AppHost.exit':
            webOS.platformBack();
            break;
    }
});

/* Server auto-discovery */

var discovered_servers = {};
var connected_servers = {};

function renderServerList(server_list) {
    for (var server_id in server_list) {
        var server = server_list[server_id];
        renderSingleServer(server_id, server);
    }
}

function renderSingleServer(server_id, server) {
    var server_list = document.getElementById("serverlist");
    var server_card = document.getElementById("server_" + server.Id);

    if (!server_card) {
        server_card = document.createElement("li");
        server_card.id = "server_" + server_id;
        server_card.className = "server_card";
        server_list.appendChild(server_card);
    }
    server_card.innerHTML = "";

    // Server name
    var title = document.createElement("div");
    title.className = "server_card_title";
    title.innerText = server.Name;
    server_card.appendChild(title);

    // Server URL
    var server_url = document.createElement("div");
    server_url.className = "server_card_url";
    server_url.innerText = server.Address;
    server_card.appendChild(server_url);

    // Button
    var btn = document.createElement("button");
    btn.innerText = "Connect";
    btn.type = "button";
    btn.value = server.Address;
    btn.onclick = function () {
        var urlfield = document.getElementById("baseurl");
        urlfield.value = this.value;
        handleServerSelect();
    };
    server_card.appendChild(btn);
}


var servers_verifying = {};

function verifyThenAdd(server) {
    if (servers_verifying[server.Id]) {
        return;
    }
    servers_verifying[server.Id] = server;

    curr_req = ajax.request(normalizeUrl(server.Address + "/System/Info/Public"), {
        method: "GET",
        success: function (data) {
            console.log("success");
            console.log(server);
            console.log(data);

            // TODO: Do we want to autodiscover only Jellyfin servers, or anything that responds to "who is JellyfinServer?"
            if (data.ProductName == "Jellyfin Server") {
                server.system_info_public = data;
                if (!discovered_servers[server.Id]) {
                    discovered_servers[server.Id] = server;
                    renderServerList(discovered_servers);
                }
            }
            servers_verifying[server.Id] = true;
        },
        error: function (data) {
            console.log("error");
            console.log(server);
            console.log(data);
            servers_verifying[server.Id] = false;
        },
        abort: function () {
            console.log("abort");
            console.log(server);
            servers_verifying[server.Id] = false;
        },
        timeout: 5000
    });
}


var discover = null;

function startDiscovery() {
    if (discover) {
        return;
    }
    console.log("Starting server autodiscovery...");
    discover = webOS.service.request("luna://org.jellyfin.webos.service", {
        method: "discover",
        parameters: {
            uniqueToken: 'fooo'
        },
        subscribe: true,
        resubscribe: true,
        onSuccess: function (args) {
            console.log('OK:', JSON.stringify(args));

            if (args.results) {
                for (var server_id in args.results) {
                    verifyThenAdd(args.results[server_id]);
                }
            }
        },
        onFailure: function (args) {
            console.log('ERR:', JSON.stringify(args));
        }
    });
}

function stopDiscovery() {
    if (discover) {
        try {
            discover.cancel();
        } catch (err) {
            console.warn(err);
        }
        discover = null;
    }
}

startDiscovery();
