/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var curr_req = false;
var server_info = false;
var manifest = false;
var whoWatching = null;
var pendingAuthContext = null;
var activeAccountContext = null;

var appInfo = {
    deviceId: null,
    deviceName: 'LG Smart TV',
    appName: 'Jellyfin for WebOS',
    appVersion: '0.0.0'
};

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


function isVisible(element) {
    return element.offsetWidth > 0 && element.offsetHeight > 0;
}

function findIndex(array, currentNode) {
    //This just implements the following function which is not available on some LG TVs
    //Array.from(allElements).findIndex(function (el) { return currentNode.isEqualNode(el); })
    for (var i = 0, item; item = array[i]; i++) {
        if (currentNode.isEqualNode(item))
            return i;
    }
}

function getFocusableElements(scope) {
    var root = scope || document;
    var nodeList = root.querySelectorAll('input, button, a, area, object, select, textarea, [contenteditable]');
    var elements = [];

    for (var i = 0; i < nodeList.length; i++) {
        if (isVisible(nodeList[i]) && !nodeList[i].disabled) {
            elements.push(nodeList[i]);
        }
    }

    return elements;
}

function navigate(amount, scope) {
    console.log("Navigating " + amount.toString() + "...")
    var element = document.activeElement;
    if (element === null) {
        navigationInit();
    } else if (!isVisible(element) || element.tagName == 'BODY') {
        var firstElements = getFocusableElements(scope);
        if (firstElements[0]) {
            firstElements[0].focus();
        } else {
            navigationInit();
        }
    } else {
        //Isolate the node that we're after
        var currentNode = element;

        //find all tab-able elements
        var allElements = getFocusableElements(scope);

        //Find the current tab index.
        var currentIndex = findIndex(allElements, currentNode);
        if (currentIndex === undefined) {
            if (allElements[0]) {
                allElements[0].focus();
            }
            return;
        }

        //focus the following element
        if (allElements[currentIndex + amount])
            allElements[currentIndex + amount].focus();
    }
}

function isWhoWatchingVisible() {
    var modal = document.querySelector('#whoWatchingModal');
    return !!(modal && isVisible(modal));
}

function isPinPromptVisible() {
    return !!(whoWatching && whoWatching.isPinPromptVisible && whoWatching.isPinPromptVisible());
}

function getDigitFromKeyCode(keyCode) {
    if (keyCode >= 48 && keyCode <= 57) {
        return keyCode - 48;
    }

    if (keyCode >= 96 && keyCode <= 105) {
        return keyCode - 96;
    }

    return null;
}

function getPinPromptScope() {
    return whoWatching && whoWatching.getPinPromptElement ? whoWatching.getPinPromptElement() : document.querySelector('.who-inline-pin');
}

function navigateWhoWatching(amount) {
    var scope = isPinPromptVisible() ? getPinPromptScope() : document.querySelector('#whoWatchingModal');
    navigate(amount, scope);
}

function hasClass(element, className) {
    return !!(element && (' ' + element.className + ' ').indexOf(' ' + className + ' ') >= 0);
}

function findAncestorWithClass(element, className) {
    while (element && element !== document) {
        if (hasClass(element, className)) {
            return element;
        }
        element = element.parentNode;
    }

    return null;
}

function indexOfElement(elements, element) {
    if (!element) {
        return -1;
    }

    for (var i = 0; i < elements.length; i++) {
        if (elements[i] === element || (element.isEqualNode && element.isEqualNode(elements[i]))) {
            return i;
        }
    }

    return -1;
}

function wrapIndex(index, length) {
    if (!length) {
        return -1;
    }

    if (index < 0) {
        return length - 1;
    }

    if (index >= length) {
        return 0;
    }

    return index;
}

function getVisibleMatches(selector, scope) {
    var root = scope || document;
    var nodeList = root.querySelectorAll(selector);
    var elements = [];

    for (var i = 0; i < nodeList.length; i++) {
        if (isVisible(nodeList[i]) && !nodeList[i].disabled) {
            elements.push(nodeList[i]);
        }
    }

    return elements;
}

function getWhoGridItems() {
    return getVisibleMatches('#whoWatchingAccounts > .who-account-tile', document);
}

function getWhoModalActions() {
    return getVisibleMatches('#manageAccounts, #changeServer', document);
}

function getManageCardActions(card) {
    return getVisibleMatches('.who-tile-actions button', card);
}

function getPinCardActions(card) {
    return getVisibleMatches('.who-inline-pin button', card);
}

function focusModalAction(index) {
    var actions = getWhoModalActions();

    if (!actions.length) {
        return false;
    }

    actions[Math.max(0, Math.min(index, actions.length - 1))].focus();
    return true;
}

function focusGridItem(index, actionIndex) {
    var items = getWhoGridItems();
    var item;
    var actions;

    if (!items.length) {
        return false;
    }

    index = Math.max(0, Math.min(index, items.length - 1));
    item = items[index];

    if (hasClass(item, 'who-pin-card')) {
        actions = getPinCardActions(item);
        if (actions.length) {
            actionIndex = Math.max(0, Math.min(actionIndex || 0, actions.length - 1));
            actions[actionIndex].focus();
            return true;
        }
    }

    if (hasClass(item, 'who-manage-card')) {
        actions = getManageCardActions(item);
        if (actions.length) {
            actionIndex = Math.max(0, Math.min(actionIndex || 0, actions.length - 1));
            actions[actionIndex].focus();
            return true;
        }
    }

    if (item.focus) {
        item.focus();
        return true;
    }

    return false;
}

function getFocusedGridInfo() {
    var active = document.activeElement;
    var tile = findAncestorWithClass(active, 'who-account-tile');
    var items = getWhoGridItems();
    var actions;

    return {
        active: active,
        tile: tile,
        items: items,
        index: indexOfElement(items, tile),
        actionIndex: tile && hasClass(tile, 'who-pin-card') ? indexOfElement(getPinCardActions(tile), active) : tile && hasClass(tile, 'who-manage-card') ? indexOfElement(getManageCardActions(tile), active) : -1
    };
}

function isModalActionFocused() {
    var active = document.activeElement;
    return !!(active && (active.id === 'manageAccounts' || active.id === 'changeServer'));
}

function isPinBottomCancelKey(element) {
    var label = element && element.innerText;
    return hasClass(element, 'pin-key') && (label === '0' || label === 'Back');
}

function focusPinCancelButton() {
    var scope = getPinPromptScope();
    var cancelButton = scope && scope.querySelector('.who-inline-pin-cancel');

    if (cancelButton && isVisible(cancelButton) && !cancelButton.disabled) {
        cancelButton.focus();
        return true;
    }

    return false;
}

function handleFocusedAccountDigit(digit) {
    var info;
    var account;

    if (!isWhoWatchingVisible() || isPinPromptVisible() || digit === null || !whoWatching || !whoWatching.getFocusedAccount) {
        return false;
    }

    info = getFocusedGridInfo();
    if (!info.tile || !hasClass(info.tile, 'who-user-tile')) {
        return false;
    }

    account = whoWatching.getFocusedAccount();
    if (!account || !account.pinProtected || !whoWatching.selectFocusedAccount || !whoWatching.appendPinDigit) {
        return false;
    }

    whoWatching.selectFocusedAccount();
    whoWatching.appendPinDigit(digit);
    return true;
}

function moveWhoWatchingHorizontal(amount) {
    var info;
    var nextIndex;
    var actions;
    var actionIndex;

    if (isPinPromptVisible()) {
        navigate(amount, getPinPromptScope());
        return;
    }

    if (isModalActionFocused()) {
        actions = getWhoModalActions();
        actionIndex = indexOfElement(actions, document.activeElement);
        actionIndex = wrapIndex(actionIndex + amount, actions.length);
        if (actionIndex >= 0) {
            actions[actionIndex].focus();
        }
        return;
    }

    info = getFocusedGridInfo();
    if (info.index >= 0) {
        nextIndex = wrapIndex(info.index + amount, info.items.length);
        focusGridItem(nextIndex, info.actionIndex >= 0 ? info.actionIndex : 0);
        return;
    }

    focusGridItem(0, 0) || focusModalAction(0);
}

function moveWhoWatchingUp() {
    var info;
    var actions;

    if (isPinPromptVisible()) {
        navigate(-3, getPinPromptScope());
        return;
    }

    if (isModalActionFocused()) {
        focusGridItem(0, 0);
        return;
    }

    info = getFocusedGridInfo();
    if (info.tile && hasClass(info.tile, 'who-manage-card')) {
        actions = getManageCardActions(info.tile);
        if (info.actionIndex > 0 && actions[info.actionIndex - 1]) {
            actions[info.actionIndex - 1].focus();
        }
    }
}

function moveWhoWatchingDown() {
    var info;
    var actions;

    if (isPinPromptVisible()) {
        if (isPinBottomCancelKey(document.activeElement) && focusPinCancelButton()) {
            return;
        }

        navigate(3, getPinPromptScope());
        return;
    }

    if (isModalActionFocused()) {
        return;
    }

    info = getFocusedGridInfo();
    if (info.tile && hasClass(info.tile, 'who-manage-card')) {
        actions = getManageCardActions(info.tile);
        if (info.actionIndex >= 0 && info.actionIndex < actions.length - 1) {
            actions[info.actionIndex + 1].focus();
            return;
        }
    }

    focusModalAction(0);
}

function upArrowPressed() {
    if (isWhoWatchingVisible()) {
        moveWhoWatchingUp();
        return;
    }

    navigate(-1);
}

function downArrowPressed() {
    if (isWhoWatchingVisible()) {
        moveWhoWatchingDown();
        return;
    }

    navigate(1);
}
function leftArrowPressed() {
    if (isWhoWatchingVisible()) {
        moveWhoWatchingHorizontal(-1);
    }
}

function rightArrowPressed() {
    if (isWhoWatchingVisible()) {
        moveWhoWatchingHorizontal(1);
    }
}

function backPressed() {
    webOS.platformBack();
}

document.onkeydown = function (evt) {
    evt = evt || window.event;
    var digit = getDigitFromKeyCode(evt.keyCode);

    if (whoWatching && whoWatching.handlePinKeyCode && whoWatching.handlePinKeyCode(evt.keyCode)) {
        return false;
    }

    if (handleFocusedAccountDigit(digit)) {
        return false;
    }

    switch (evt.keyCode) {
        case 37:
            leftArrowPressed();
            return false;
        case 39:
            rightArrowPressed();
            return false;
        case 38:
            upArrowPressed();
            return false;
        case 40:
            downArrowPressed();
            return false;
        case 461: // Back
            if (isPinPromptVisible()) {
                whoWatching.hidePinPrompt();
                return false;
            }
            backPressed();
            return false;
    }
};

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

function navigationInit() {
    if (isWhoWatchingVisible()) {
        var pinScope = getPinPromptScope();
        var modalButton = isPinPromptVisible() && pinScope ? pinScope.querySelector('button') : document.querySelector('#whoWatchingModal button');
        if (modalButton) {
            modalButton.focus();
        }
    } else if (isVisible(document.querySelector('#connect'))) {
        document.querySelector('#connect').focus()
    } else if (isVisible(document.querySelector('#abort'))) {
        document.querySelector('#abort').focus()
    }
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

    navigationInit();

    if (storage.exists('connected_servers')) {
        connected_servers = storage.get('connected_servers')
        var first_server = connected_servers[Object.keys(connected_servers)[0]]
        document.querySelector('#baseurl').value = first_server.baseurl;
        document.querySelector('#auto_connect').checked = first_server.auto_connect;
        if (window.performance && window.performance.navigation.type == window.performance.navigation.TYPE_BACK_FORWARD) {
            console.log('Got here using the browser "Back" or "Forward" button, inhibiting auto connect.');
        } else {
            if (first_server.auto_connect) {
                console.log("Auto connecting...");
                handleServerSelect();
            }
        }
        renderServerList(connected_servers);
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

function handleServerSelect() {
    var baseurl = normalizeUrl(document.querySelector('#baseurl').value);
    var auto_connect = document.querySelector('#auto_connect').checked;

    if (validURL(baseurl)) {

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
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#busy').style.display = '';
    navigationInit();
}
function hideConnecting() {
    document.querySelector('#serverInfoForm').style.display = '';
    document.querySelector('#busy').style.display = 'none';
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

        // avoid Promise as it's buggy in some WebOS
            getTextToInject(function (bundle) {
                showWhoWatchingForServer(info, hosturl, bundle);
            }, function (error) {
                console.error(error);
                displayError(error);
                hideConnecting();
                curr_req = false;
            });
            return;
        }
    }
    //no id, unshoft generates unique(?) index
    connected_servers.unshift({
        'baseurl': baseurl,
        'hosturl': hosturl,
        'Name': data.shortname,
        'Address': new URL(baseurl).hostname.slice(0,8),
    })
    storage.set('connected_server', servers)
    console.log("martin:handleSuccessManifest added server");
    console.log(info);
}

function getServerId(info) {
    return info && (info.id || info.Id || info.ServerId);
}

function ensureWhoWatchingModal() {
    if (!whoWatching) {
        whoWatching = new WhoWatchingModal(document);
    }

    return whoWatching;
}

function showServerSelection() {
    pendingAuthContext = null;
    activeAccountContext = null;
    appInfo.deviceId = getDeviceId();

    if (whoWatching) {
        whoWatching.hide();
    }

    document.querySelector('.container').style.display = '';
    document.querySelector('#serverInfoForm').style.display = '';
    document.querySelector('#busy').style.display = 'none';
    startDiscovery();
    navigationInit();
}

function showWhoWatchingForServer(info, hosturl, bundle, error) {
    var serverId = getServerId(info);
    var modal = ensureWhoWatchingModal();
    var accounts = accountStore.listForServer(serverId);

    document.querySelector('.container').style.display = '';
    document.querySelector('#serverInfoForm').style.display = 'none';
    document.querySelector('#busy').style.display = 'none';

    modal.show({
        server: info,
        accounts: accounts,
        error: error,
        onSelectAccount: function (account) {
            selectAccountWithPin(info, hosturl, bundle, account);
        },
        onAddAccount: function () {
            beginAddAccount(info, hosturl, bundle);
        },
        onSetPin: function (account) {
            setPinForAccount(info, hosturl, bundle, account);
        },
        onClearPin: function (account) {
            clearPinForAccount(info, hosturl, bundle, account);
        },
        onRemoveAccount: function (account) {
            removeAccountFromThisTv(info, hosturl, bundle, account);
        },
        onChangeServer: showServerSelection
    });
}

function getAccountLabel(account) {
    return account.userName || 'this account';
}

function getPinFormatError(pin) {
    if (!AccountStore.isValidPin(pin)) {
        return 'PIN must be 4 to 6 digits.';
    }

    return null;
}

function requireAccountPin(account, options, onSuccess) {
    var modal = ensureWhoWatchingModal();

    if (!account.pinProtected) {
        return onSuccess ? onSuccess() : true;
    }

    modal.showPinPrompt({
        account: account,
        title: options.title || 'Enter PIN',
        message: options.message || ('Enter the PIN for ' + getAccountLabel(account) + '.'),
        buttonText: options.buttonText || 'Continue',
        autoLength: account.pinLength,
        formatError: getPinFormatError(''),
        onSubmit: function (pin) {
            var formatError = getPinFormatError(pin);
            if (formatError) {
                return formatError;
            }

            if (!accountStore.verifyPin(account.serverId, account.accountId, pin)) {
                return 'Incorrect PIN.';
            }

            return onSuccess ? onSuccess() : true;
        }
    });

    return false;
}

function selectAccountWithPin(info, hosturl, bundle, account) {
    requireAccountPin(account, {
        title: 'Enter PIN',
        message: 'Enter the PIN for ' + getAccountLabel(account) + '.',
        buttonText: 'Continue'
    }, function () {
        activateRememberedAccount(info, hosturl, bundle, account);
        return true;
    });
}

function promptForNewPin(info, hosturl, bundle, account) {
    var modal = ensureWhoWatchingModal();
    var firstPin = null;

    modal.showPinPrompt({
        account: account,
        title: account.pinProtected ? 'Change PIN' : 'Set PIN',
        message: 'Enter a 4 to 6 digit PIN for ' + getAccountLabel(account) + '.',
        buttonText: 'Next',
        formatError: getPinFormatError(''),
        onSubmit: function (pin) {
            var formatError = getPinFormatError(pin);
            if (formatError) {
                return formatError;
            }

            firstPin = pin;
            modal.showPinPrompt({
                account: account,
                title: 'Confirm PIN',
                message: 'Enter the same PIN again.',
                buttonText: 'Save PIN',
                autoLength: firstPin.length,
                formatError: getPinFormatError(''),
                onSubmit: function (confirmPin) {
                    var confirmError = getPinFormatError(confirmPin);
                    if (confirmError) {
                        return confirmError;
                    }

                    if (confirmPin !== firstPin) {
                        return 'PINs do not match.';
                    }

                    accountStore.setPin(account.serverId, account.accountId, firstPin);
                    showWhoWatchingForServer(info, hosturl, bundle);
                    return true;
                }
            });

            return false;
        }
    });
}

function setPinForAccount(info, hosturl, bundle, account) {
    if (!account.pinProtected) {
        promptForNewPin(info, hosturl, bundle, account);
        return;
    }

    requireAccountPin(account, {
        title: 'Change PIN',
        message: 'Enter the current PIN for ' + getAccountLabel(account) + '.',
        buttonText: 'Continue'
    }, function () {
        promptForNewPin(info, hosturl, bundle, account);
        return false;
    });
}

function clearPinForAccount(info, hosturl, bundle, account) {
    requireAccountPin(account, {
        title: 'Clear PIN',
        message: 'Enter the current PIN for ' + getAccountLabel(account) + '.',
        buttonText: 'Clear PIN'
    }, function () {
        accountStore.clearPin(account.serverId, account.accountId);
        showWhoWatchingForServer(info, hosturl, bundle);
        return true;
    });
}

function removeAccountFromThisTv(info, hosturl, bundle, account) {
    requireAccountPin(account, {
        title: 'Remove account',
        message: 'Enter the PIN before removing ' + getAccountLabel(account) + ' from this TV.',
        buttonText: 'Remove'
    }, function () {
        accountStore.removeAccount(account.serverId, account.accountId);
        showWhoWatchingForServer(info, hosturl, bundle);
        return true;
    });
}

function beginAddAccount(info, hosturl, bundle) {
    var deviceId = AccountStore.generateDeviceId();

    pendingAuthContext = {
        mode: 'add',
        serverInfo: info,
        deviceId: deviceId
    };
    activeAccountContext = null;

    handoffWithCredential(info, hosturl, bundle, null, deviceId);
}

function beginReauth(info, hosturl, bundle, account) {
    var deviceId = account.deviceId || AccountStore.generateDeviceId();

    pendingAuthContext = {
        mode: 'reauth',
        serverInfo: info,
        accountId: account.accountId,
        expectedUserId: account.userId,
        deviceId: deviceId
    };
    activeAccountContext = null;

    handoffWithCredential(info, hosturl, bundle, null, deviceId);
}

function activateRememberedAccount(info, hosturl, bundle, account) {
    if (!account.accessToken || account.needsReauth) {
        beginReauth(info, hosturl, bundle, account);
        return;
    }

    ensureWhoWatchingModal().setError('Checking account...');

    curr_req = AccountAuth.validateToken(ajax, info, account, {
        appName: appInfo.appName,
        appVersion: appInfo.appVersion,
        deviceName: appInfo.deviceName,
        deviceId: account.deviceId
    }, {
        success: function (user) {
            curr_req = false;
            var updatedAccount = accountStore.updateDisplayInfo(getServerId(info), account.accountId, user) || accountStore.markUsed(getServerId(info), account.accountId) || account;
            handoffWithCredential(info, hosturl, bundle, updatedAccount, updatedAccount.deviceId);
        },
        invalid: function () {
            curr_req = false;
            var invalidAccount = accountStore.markNeedsReauth(getServerId(info), account.accountId) || account;
            beginReauth(info, hosturl, bundle, invalidAccount);
        },
        networkError: function () {
            curr_req = false;
            ensureWhoWatchingModal().setError('Could not validate this account. Check the connection and try again.');
        }
    });
}

function generateSeedNonce() {
    return AccountStore.generateDeviceId() + '-' + new Date().getTime();
}

function handoffWithCredential(info, hosturl, bundle, account, deviceId) {
    var credential = AccountAuth.createJellyfinWebServerCredential(info, account, new Date().getTime());
    var seedNonce = generateSeedNonce();

    if (whoWatching) {
        whoWatching.hide();
    }

    displayConnecting();
    appInfo.deviceId = deviceId || getDeviceId();

    if (account) {
        pendingAuthContext = null;
        activeAccountContext = {
            serverInfo: info,
            accountId: account.accountId,
            deviceId: account.deviceId
        };
    }

    handoff(hosturl, bundle, {
        serverCredential: credential,
        credentialSeedUrl: AccountAuth.createCredentialSeedUrl(info, seedNonce),
        seedNonce: seedNonce
    });
}

function handleLocalUserSignedIn(data) {
    if (!data || !data.user || !data.accessToken) {
        return;
    }

    var context = pendingAuthContext || activeAccountContext;
    if (!context || !context.serverInfo) {
        return;
    }

    var account = accountStore.saveAuthenticatedAccount(
        context.serverInfo,
        data.user,
        data.accessToken,
        context.deviceId || appInfo.deviceId
    );

    pendingAuthContext = null;
    activeAccountContext = {
        serverInfo: context.serverInfo,
        accountId: account.accountId,
        deviceId: account.deviceId
    };
}

function handleLocalUserSignedOut(logoutInfo) {
    var serverId = logoutInfo && logoutInfo.serverId;
    var accountId = activeAccountContext && activeAccountContext.accountId;

    if (!serverId && activeAccountContext && activeAccountContext.serverInfo) {
        serverId = getServerId(activeAccountContext.serverInfo);
    }

    if (!accountId && serverId) {
        var selected = accountStore.getSelectedAccount(serverId);
        accountId = selected && selected.accountId;
    }

    if (serverId && accountId) {
        accountStore.markNeedsReauth(serverId, accountId);
    }

    activeAccountContext = null;
    pendingAuthContext = null;
}

function handleAbort() {
    console.log("Aborted.")
    hideConnecting();
    curr_req = false;
}

function handleFailure(data) {
    console.log("Failure:", data)
    console.log("Could not connect to server...")
    if (data.error == 'timeout') {
        displayError("The request timed out.")
    } else if (data.error == 'abort') {
        displayError("The request was aborted.")
    } else if (typeof data.error === 'string') {
        displayError(data.error);
    } else if (typeof data.error === 'number' && data.error > 0) {
        displayError("Got HTTP error " + data.error.toString() + " from server, are you connecting to a Jellyfin Server?")
    } else {
        displayError("Unknown error occured, are you connecting to a Jellyfin Server?")
    }

    hideConnecting();
    storage.remove('connected_server');
    curr_req = false;
}

function abort() {
    if (curr_req) {
        curr_req.abort()
    } else {
        hideConnecting();
    }
    console.log("Aborting...");
}

function loadUrl(url, success, failure) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', url);

    xhr.onload = function () {
        success(xhr.responseText);
    };

    xhr.onerror = function () {
        failure("Failed to load '" + url + "'");
    }

    xhr.send();
}

function getTextToInject(success, failure) {
    var bundle = {};

    var urls = ['js/webOS.js', 'css/webOS.css'];

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

function injectScriptText(document, text) {
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.innerHTML = text;
    document.head.appendChild(script);
}

function injectStyleText(document, text) {
    var style = document.createElement('style');
    style.innerHTML = text;
    document.body.appendChild(style);
}

function handoff(url, bundle, options) {
    console.log("Handoff called with: ", url)
    //hideConnecting();
    options = options || {};

    stopDiscovery();
    document.querySelector('.container').style.display = 'none';

    var contentFrame = document.querySelector('#contentFrame');
    var contentWindow = contentFrame.contentWindow;

    var timer;
    var awaitingCredentialSeed = !!options.serverCredential;

    function seedCredentialsAndNavigate() {
        try {
            AccountAuth.seedJellyfinWebCredentials(contentFrame.contentWindow.localStorage, options.serverCredential);
            awaitingCredentialSeed = false;
            contentFrame.contentWindow.location.replace(url);
            return true;
        } catch (err) {
            console.warn('Direct credential seed failed, falling back to injected seed script.', err);
            try {
                injectScriptText(contentFrame.contentDocument, AccountAuth.createCredentialSeedScript(options.serverCredential, url, options.seedNonce));
                awaitingCredentialSeed = false;
                return true;
            } catch (scriptErr) {
                console.error('Failed to seed Jellyfin credentials.', scriptErr);
                awaitingCredentialSeed = false;
                return false;
            }
        }
    }

    function onLoad() {
        clearInterval(timer);

        if (awaitingCredentialSeed) {
            if (seedCredentialsAndNavigate()) {
                return;
            }
        }

        contentFrame.contentDocument.removeEventListener('DOMContentLoaded', onLoad);
        contentFrame.removeEventListener('load', onLoad);

        injectScriptText(contentFrame.contentDocument, 'window.AppInfo = ' + JSON.stringify(appInfo) + ';');
        injectScriptText(contentFrame.contentDocument, 'window.DeviceInfo = ' + JSON.stringify(deviceInfo) + ';');

        if (bundle.js) {
            injectScriptText(contentFrame.contentDocument, bundle.js);
        }

        if (bundle.css) {
            injectStyleText(contentFrame.contentDocument, bundle.css);
        }
    }

    function onUnload() {
        contentWindow.removeEventListener('unload', onUnload);

        timer = setInterval(function () {
            var contentDocument = contentFrame.contentDocument;

            switch (contentDocument.readyState) {
                case 'loading':
                    clearInterval(timer);
                    contentDocument.addEventListener('DOMContentLoaded', onLoad);
                    break;

                // In the case of "loading" is not caught
                case 'interactive':
                    onLoad();
                    break;
            }
        }, 0);
    }

    contentWindow.addEventListener('unload', onUnload);

    // In the case of "loading" and "interactive" are not caught
    contentFrame.addEventListener('load', onLoad);

    contentFrame.style.display = '';
    contentFrame.src = options.credentialSeedUrl || url;
}

window.addEventListener('message', function (msg) {
    msg = msg.data;

    var contentFrame = document.querySelector('#contentFrame');

    switch (msg.type) {
        case 'selectServer':
            contentFrame.style.display = 'none';
            contentFrame.src = '';
            showServerSelection();
            break;
        case 'jf-local-user-signed-in':
            handleLocalUserSignedIn(msg.data);
            break;
        case 'jf-local-user-signed-out':
            handleLocalUserSignedOut(msg.data);
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
