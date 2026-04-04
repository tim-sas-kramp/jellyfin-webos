/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

var pendingConnectionContext = null;
var currentHandoffContext = null;

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
