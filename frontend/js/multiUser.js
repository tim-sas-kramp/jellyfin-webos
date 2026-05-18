/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 */

(function () {
    'use strict';

    var appInfo = window.AppInfo || {};
    var multiUser = appInfo.multiUser || {};
    var activeSession = multiUser.activeSession || null;
    var server = multiUser.server || null;
    var maxApiClientPolls = 600;
    var fallbackButtonId = 'jfmu-switch-user';

    function isLocalStorageInstance(storageInstance) {
        try {
            return storageInstance === window.localStorage;
        } catch (error) {
            return false;
        }
    }

    function isGlobalKey(key) {
        return key === '_deviceId2'
            || key === 'jellyfin_credentials'
            || key === 'jellyfin_multi_user_v1';
    }

    function getScopedKey(key) {
        if (!activeSession || !activeSession.namespace || isGlobalKey(key)) {
            return key;
        }

        return activeSession.namespace + key;
    }

    function patchLocalStorage() {
        var storagePrototype = window.Storage && window.Storage.prototype;

        if (!storagePrototype || storagePrototype.__jfMultiUserPatched || !activeSession || !activeSession.namespace) {
            return;
        }

        storagePrototype.__jfMultiUserPatched = true;
        storagePrototype.__jfMultiUserGetItem = storagePrototype.getItem;
        storagePrototype.__jfMultiUserSetItem = storagePrototype.setItem;
        storagePrototype.__jfMultiUserRemoveItem = storagePrototype.removeItem;
        storagePrototype.__jfMultiUserClear = storagePrototype.clear;

        storagePrototype.getItem = function (key) {
            if (!isLocalStorageInstance(this)) {
                return storagePrototype.__jfMultiUserGetItem.call(this, key);
            }

            return storagePrototype.__jfMultiUserGetItem.call(this, getScopedKey(key));
        };

        storagePrototype.setItem = function (key, value) {
            if (!isLocalStorageInstance(this)) {
                return storagePrototype.__jfMultiUserSetItem.call(this, key, value);
            }

            return storagePrototype.__jfMultiUserSetItem.call(this, getScopedKey(key), value);
        };

        storagePrototype.removeItem = function (key) {
            if (!isLocalStorageInstance(this)) {
                return storagePrototype.__jfMultiUserRemoveItem.call(this, key);
            }

            return storagePrototype.__jfMultiUserRemoveItem.call(this, getScopedKey(key));
        };

        storagePrototype.clear = function () {
            if (!isLocalStorageInstance(this) || !activeSession || !activeSession.namespace) {
                return storagePrototype.__jfMultiUserClear.call(this);
            }

            for (var i = this.length - 1; i >= 0; i--) {
                var key = this.key(i);
                if (key && key.indexOf(activeSession.namespace) === 0) {
                    storagePrototype.__jfMultiUserRemoveItem.call(this, key);
                }
            }
        };
    }

    function installApiClientStub() {
        if (!server || !server.baseurl) {
            return;
        }

        if (!window.ApiClient || typeof window.ApiClient.serverAddress !== 'function' || window.ApiClient.__jfMultiUserStub) {
            window.ApiClient = window.ApiClient || {};
            window.ApiClient.__jfMultiUserStub = true;
            window.ApiClient.serverAddress = function () {
                return server.baseurl;
            };
        }
    }

    function patchConfigRequestBody(body) {
        var config;

        try {
            config = JSON.parse(body);
        } catch (error) {
            return body;
        }

        config.multiserver = true;
        return JSON.stringify(config);
    }

    function patchConfigRequests() {
        var xhrPrototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;

        if (!xhrPrototype || xhrPrototype.__jfMultiUserConfigPatched) {
            return;
        }

        xhrPrototype.__jfMultiUserConfigPatched = true;
        xhrPrototype.__jfMultiUserOpen = xhrPrototype.open;
        xhrPrototype.__jfMultiUserSend = xhrPrototype.send;

        xhrPrototype.open = function (method, url) {
            this.__jfMultiUserRequestUrl = url || '';
            return xhrPrototype.__jfMultiUserOpen.apply(this, arguments);
        };

        xhrPrototype.send = function () {
            var requestUrl = this.__jfMultiUserRequestUrl || '';
            var shouldPatchConfig = /(^|\/)config\.json(?:\?|$)/i.test(requestUrl);

            if (shouldPatchConfig && !this.__jfMultiUserConfigListener) {
                this.__jfMultiUserConfigListener = true;
                this.addEventListener('readystatechange', function () {
                    if (this.readyState !== 4) {
                        return;
                    }

                    try {
                        var patchedBody = patchConfigRequestBody(this.responseText);

                        if (patchedBody === this.responseText) {
                            return;
                        }

                        Object.defineProperty(this, 'responseText', {
                            configurable: true,
                            get: function () {
                                return patchedBody;
                            }
                        });

                        Object.defineProperty(this, 'response', {
                            configurable: true,
                            get: function () {
                                return patchedBody;
                            }
                        });
                    } catch (error) {
                        console.warn('[multiUser] failed to patch config.json', error);
                    }
                });
            }

            return xhrPrototype.__jfMultiUserSend.apply(this, arguments);
        };
    }

    function openUserSwitcher() {
        if (window.NativeShell && typeof window.NativeShell.openUserSwitcher === 'function') {
            window.NativeShell.openUserSwitcher();
            return;
        }

        if (window.NativeShell && typeof window.NativeShell.selectServer === 'function') {
            window.NativeShell.selectServer();
        }
    }

    function removeFallbackSwitcherButton() {
        var button = document.getElementById(fallbackButtonId);

        if (button && button.parentNode) {
            button.parentNode.removeChild(button);
        }
    }

    function markSwitchUserItem(node) {
        if (!node) {
            return;
        }

        node.setAttribute('data-jfmu-native-switcher', 'true');

        if (node.classList) {
            node.classList.add('jfmu-switch-user-item');
        }
    }

    function findMenuItemTextNode(menuItem) {
        if (!menuItem) {
            return null;
        }

        var textContainer = menuItem.querySelector('.MuiListItemText-root')
            || menuItem.querySelector('[class*="MuiListItemText"]')
            || menuItem.querySelector('.navMenuOptionText');

        if (textContainer) {
            return textContainer.querySelector('.MuiTypography-root')
                || textContainer.querySelector('[class*="MuiTypography"]')
                || textContainer.querySelector('span')
                || textContainer.querySelector('p')
                || textContainer.querySelector('div')
                || textContainer;
        }

        var spans = menuItem.querySelectorAll('span, p');

        for (var i = 0; i < spans.length; i++) {
            if (!spans[i].children.length) {
                return spans[i];
            }
        }

        return null;
    }

    function findMenuItemIconNode(menuItem) {
        if (!menuItem) {
            return null;
        }

        return menuItem.querySelector('.MuiListItemIcon-root')
            || menuItem.querySelector('[class*="MuiListItemIcon"]')
            || menuItem.querySelector('.navMenuOptionIcon');
    }

    function setMenuItemLabel(menuItem, label, templateItem) {
        if (!menuItem) {
            return;
        }

        var textNode = findMenuItemTextNode(menuItem);

        if (textNode) {
            textNode.textContent = label;
            return;
        }

        if (templateItem) {
            var templateIcon = findMenuItemIconNode(templateItem);
            var templateTextNode = findMenuItemTextNode(templateItem);
            var templateTextContainer = templateTextNode && templateTextNode.parentNode !== templateItem
                ? templateTextNode.parentNode
                : null;

            menuItem.innerHTML = '';

            if (templateIcon) {
                menuItem.appendChild(templateIcon.cloneNode(true));
            }

            if (templateTextContainer) {
                var clonedTextContainer = templateTextContainer.cloneNode(true);
                var clonedTextNode = findMenuItemTextNode(clonedTextContainer) || clonedTextContainer;
                clonedTextNode.textContent = label;
                menuItem.appendChild(clonedTextContainer);
                return;
            }
        }

        menuItem.textContent = label;
    }

    function setMaterialIconName(iconNode, iconName) {
        if (!iconNode) {
            return;
        }

        if (typeof iconNode.textContent === 'string') {
            iconNode.textContent = iconName;
        }

        var iconNames = ['storage', 'account_circle', 'person'];

        if (iconNode.classList) {
            for (var i = 0; i < iconNames.length; i++) {
                iconNode.classList.remove(iconNames[i]);
            }

            iconNode.classList.add(iconName);
            return;
        }

        var className = iconNode.className || '';
        for (var j = 0; j < iconNames.length; j++) {
            className = className.replace(new RegExp('(^|\\s)' + iconNames[j] + '(?=\\s|$)', 'g'), ' ');
        }

        iconNode.className = (className.replace(/\s+/g, ' ').trim() + ' ' + iconName).replace(/^\s+|\s+$/g, '');
    }

    function createPersonMaterialIconMarkup(useNavMenuClass) {
        return '<span class="material-icons' + (useNavMenuClass ? ' navMenuOptionIcon person' : '') + '" aria-hidden="true">person</span>';
    }

    function createPersonSvgMarkup() {
        return ''
            + '<svg class="MuiSvgIcon-root" focusable="false" aria-hidden="true" viewBox="0 0 24 24">'
            + '<path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5Zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5Z"></path>'
            + '</svg>';
    }

    function getMenuItemIconTemplate(menuItem) {
        var menu = document.getElementById('app-user-menu');

        if (!menu) {
            return null;
        }

        var items = menu.querySelectorAll('[role="menuitem"]');

        for (var i = 0; i < items.length; i++) {
            if (items[i] !== menuItem) {
                return items[i];
            }
        }

        return null;
    }

    function setMenuItemIcon(menuItem, templateItem) {
        if (!menuItem) {
            return;
        }

        var muiIconContainer = menuItem.querySelector('.MuiListItemIcon-root, [class*="MuiListItemIcon"]');
        var materialIconNode = menuItem.querySelector('.navMenuOptionIcon, .material-icons');
        var iconNode = findMenuItemIconNode(menuItem);
        var iconTemplateItem = templateItem || getMenuItemIconTemplate(menuItem);
        var templateIconNode = findMenuItemIconNode(iconTemplateItem);

        if (muiIconContainer) {
            muiIconContainer.innerHTML = createPersonSvgMarkup();
            return;
        }

        if (materialIconNode) {
            setMaterialIconName(materialIconNode, 'person');
            return;
        }

        if (iconNode && templateIconNode && iconNode.parentNode) {
            iconNode.parentNode.replaceChild(templateIconNode.cloneNode(true), iconNode);
            setMenuItemIcon(menuItem);
            return;
        }

        if (!iconNode && templateIconNode) {
            menuItem.insertBefore(templateIconNode.cloneNode(true), menuItem.firstChild);
            setMenuItemIcon(menuItem);
        }
    }

    function updateAppUserMenuSwitcherIcon() {
        var menu = document.getElementById('app-user-menu');

        if (!menu) {
            return;
        }

        var items = menu.querySelectorAll('[role="menuitem"]');

        for (var i = 0; i < items.length; i++) {
            var textNode = findMenuItemTextNode(items[i]);
            var text = (textNode && textNode.textContent ? textNode.textContent : items[i].textContent || '').trim();

            if (text === 'Switch User' || text === 'Select Server' || text === 'Select server') {
                setMenuItemLabel(items[i], 'Switch User');
                setMenuItemIcon(items[i]);
                markSwitchUserItem(items[i]);
            }
        }
    }

    function menuHasSwitcher(menu) {
        var items = menu.querySelectorAll('[role="menuitem"]');

        for (var i = 0; i < items.length; i++) {
            if (items[i].getAttribute('data-itemid') === 'selectserver') {
                markSwitchUserItem(items[i]);
                return true;
            }

            var textNode = findMenuItemTextNode(items[i]);
            var text = (textNode && textNode.textContent ? textNode.textContent : items[i].textContent || '').trim();

            if (text === 'Switch User' || text === 'Select Server' || text === 'Select server') {
                markSwitchUserItem(items[i]);
                return true;
            }
        }

        return false;
    }

    function injectUserMenuSwitcher() {
        var menu = document.getElementById('app-user-menu');
        if (!menu || menu.querySelector('[data-jfmu-switch-user]')) {
            return;
        }

        if (menuHasSwitcher(menu)) {
            return;
        }

        var templateItem = menu.querySelector('[role="menuitem"]');
        if (!templateItem) {
            return;
        }

        var switcherItem = templateItem.cloneNode(true);
        var templateStyle = window.getComputedStyle ? window.getComputedStyle(templateItem) : null;

        switcherItem.setAttribute('data-jfmu-switch-user', 'true');
        markSwitchUserItem(switcherItem);

        if (templateStyle) {
            switcherItem.style.minHeight = templateStyle.minHeight;
            switcherItem.style.alignItems = templateStyle.alignItems;
            switcherItem.style.justifyContent = templateStyle.justifyContent;
        }

        setMenuItemLabel(switcherItem, 'Switch User', templateItem);
        setMenuItemIcon(switcherItem, templateItem);

        switcherItem.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            openUserSwitcher();
        });

        var menuList = templateItem.parentNode;
        if (menuList) {
            menuList.insertBefore(switcherItem, templateItem);
        }
    }

    function syncApiClient(apiClient) {
        if (!apiClient || !server) {
            return;
        }

        var serverInfo = typeof apiClient.serverInfo === 'function' ? (apiClient.serverInfo() || {}) : {};

        serverInfo.Id = server.serverId || serverInfo.Id || '';
        serverInfo.Name = server.serverName || serverInfo.Name || '';
        serverInfo.ManualAddress = server.baseurl || serverInfo.ManualAddress || '';
        serverInfo.DateLastAccessed = new Date().getTime();
        serverInfo.LastConnectionMode = 2;

        serverInfo.UserId = activeSession ? (activeSession.userId || null) : null;
        serverInfo.AccessToken = activeSession ? (activeSession.accessToken || null) : null;

        if (typeof apiClient.serverInfo === 'function') {
            apiClient.serverInfo(serverInfo);
        }

        if (server.baseurl && typeof apiClient.serverAddress === 'function') {
            apiClient.serverAddress(server.baseurl);
        }

        if (typeof apiClient.setAuthenticationInfo === 'function') {
            apiClient.setAuthenticationInfo(serverInfo.AccessToken || null, serverInfo.UserId || null);
        }
    }

    function wrapApiClient() {
        var attempts = 0;
        var timer = setInterval(function () {
            attempts++;

            var apiClient = window.ApiClient;
            if (!apiClient || typeof apiClient.setAuthenticationInfo !== 'function') {
                if (attempts >= maxApiClientPolls) {
                    clearInterval(timer);
                }
                return;
            }

            clearInterval(timer);

            if (apiClient.__jfMultiUserWrapped) {
                syncApiClient(apiClient);
                return;
            }

            apiClient.__jfMultiUserWrapped = true;

            var originalAjax = typeof apiClient.ajax === 'function' ? apiClient.ajax : null;
            var originalFetch = typeof apiClient.fetch === 'function' ? apiClient.fetch : null;
            var originalUpdateServerInfo = typeof apiClient.updateServerInfo === 'function' ? apiClient.updateServerInfo : null;

            syncApiClient(apiClient);

            if (originalUpdateServerInfo) {
                apiClient.updateServerInfo = function (serverInfo, serverUrl) {
                    syncApiClient(this);
                    return originalUpdateServerInfo.call(this, serverInfo || {}, server.baseurl || serverUrl);
                };
            }

            if (originalAjax) {
                apiClient.ajax = function (request, enableAutomaticNetworking) {
                    syncApiClient(this);
                    return originalAjax.call(this, request, enableAutomaticNetworking);
                };
            }

            if (originalFetch) {
                apiClient.fetch = function (request, enableAutomaticNetworking) {
                    syncApiClient(this);
                    return originalFetch.call(this, request, enableAutomaticNetworking);
                };
            }
        }, 50);
    }

    function writeCredentials() {
        if (!multiUser.jellyfinCredentials || !localStorage) {
            return;
        }

        localStorage.setItem('jellyfin_credentials', JSON.stringify(multiUser.jellyfinCredentials));
    }

    function applyStartupRoute() {
        if (!multiUser.initialHash) {
            return;
        }

        if (window.location.hash !== multiUser.initialHash) {
            window.location.hash = multiUser.initialHash;
        }
    }

    function replaceSelectServerLabels() {
        var structuredNodes = document.querySelectorAll('.btnSelectServer, [data-itemid="selectserver"], [role="menuitem"]');

        for (var i = 0; i < structuredNodes.length; i++) {
            var structuredNode = structuredNodes[i];
            var structuredTextNode = findMenuItemTextNode(structuredNode);
            var structuredText = (structuredTextNode && structuredTextNode.textContent
                ? structuredTextNode.textContent
                : structuredNode.textContent || '').trim();

            if (structuredText === 'Switch User' || structuredText === 'Select Server' || structuredText === 'Select server') {
                setMenuItemLabel(structuredNode, 'Switch User');
                setMenuItemIcon(structuredNode);
                markSwitchUserItem(structuredNode);
            }
        }

        var textNodes = document.querySelectorAll('button, a, span, div');

        for (var j = 0; j < textNodes.length; j++) {
            var node = textNodes[j];

            if (node.children && node.children.length) {
                continue;
            }

            var text = (node.textContent || '').trim();

            if (text === 'Select Server' || text === 'Select server') {
                node.textContent = 'Switch User';
            }
        }

        injectUserMenuSwitcher();
        updateAppUserMenuSwitcherIcon();
        removeFallbackSwitcherButton();
    }

    function startLabelObserver() {
        if (!window.MutationObserver) {
            return;
        }

        if (!document.documentElement) {
            return;
        }

        var observer = new MutationObserver(function () {
            replaceSelectServerLabels();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    patchLocalStorage();
    patchConfigRequests();
    writeCredentials();
    installApiClientStub();
    applyStartupRoute();
    wrapApiClient();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', replaceSelectServerLabels);
    } else {
        replaceSelectServerLabels();
    }

    startLabelObserver();
})();
