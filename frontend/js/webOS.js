/* 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

(function(AppInfo, deviceInfo) {
    'use strict';

    console.log('WebOS adapter');

    var multiUser = AppInfo && AppInfo.multiUser ? AppInfo.multiUser : {};

    function postMessage(type, data) {
        window.top.postMessage({
            type: type,
            data: data
        }, '*');
    }

    function openLauncherUserPicker(messageType) {
        try {
            if (window.top && typeof window.top.showUserPicker === 'function') {
                window.top.showUserPicker();
                return true;
            }
        } catch (error) {
            console.warn('[webOS] direct launcher access failed', error);
        }

        postMessage(messageType || 'multiUser.openSwitcher');
        return false;
    }

    // List of supported features
    var SupportedFeatures = [
        'exit',
        'externallinkdisplay',
        'htmlaudioautoplay',
        'htmlvideoautoplay',
        'imageanalysis',
        'physicalvolumecontrol',
        'displaylanguage',
        'otherapppromotions',
        'targetblank',
        'screensaver',
        'subtitleappearancesettings',
        'subtitleburnsettings',
        'chromecast',
        'multiserver'
    ];

    window.NativeShell = {
        AppHost: {
            init: function () {
                postMessage('AppHost.init', AppInfo);
                return Promise.resolve(AppInfo);
            },

            appName: function () {
                postMessage('AppHost.appName', AppInfo.appName);
                return AppInfo.appName;
            },

            appVersion: function () {
                postMessage('AppHost.appVersion', AppInfo.appVersion);
                return AppInfo.appVersion;
            },

            deviceId: function () {
                postMessage('AppHost.deviceId', AppInfo.deviceId);
                return AppInfo.deviceId;
            },

            deviceName: function () {
                postMessage('AppHost.deviceName', AppInfo.deviceName);
                return AppInfo.deviceName;
            },

            exit: function () {
                postMessage('AppHost.exit');
            },

            getDefaultLayout: function () {
                postMessage('AppHost.getDefaultLayout', 'tv');
                return 'tv';
            },

            getDeviceProfile: function (profileBuilder) {
                postMessage('AppHost.getDeviceProfile');
                return profileBuilder({
                    enableMkvProgressive: false,
                    enableSsaRender: true,
                    supportsDolbyAtmos: deviceInfo ? deviceInfo.dolbyAtmos : null,
                    supportsDolbyVision: deviceInfo ? deviceInfo.dolbyVision : null,
                    supportsHdr10: deviceInfo ? deviceInfo.hdr10 : null
                });
            },

            getSyncProfile: function (profileBuilder) {
                postMessage('AppHost.getSyncProfile');
                return profileBuilder({ enableMkvProgressive: false });
            },

            supports: function (command) {
                var isSupported = command && SupportedFeatures.indexOf(command.toLowerCase()) != -1;
                postMessage('AppHost.supports', {
                    command: command,
                    isSupported: isSupported
                });
                return isSupported;
            },

            screen: function () {
                return deviceInfo ? {
                    width: deviceInfo.screenWidth,
                    height: deviceInfo.screenHeight
                } : null;
            }
        },

        selectServer: function () {
            openLauncherUserPicker('selectServer');
        },

        openUserSwitcher: function () {
            openLauncherUserPicker('multiUser.openSwitcher');
        },

        onLocalUserSignedIn: function (user, accessToken) {
            var apiClient = window.ApiClient;
            var serverInfo = apiClient && typeof apiClient.serverInfo === 'function' ? (apiClient.serverInfo() || {}) : {};
            var payload = {
                userId: user && user.Id,
                displayName: user && user.Name,
                accessToken: accessToken || (apiClient && typeof apiClient.accessToken === 'function' ? apiClient.accessToken() : null),
                serverId: serverInfo.Id || (multiUser.server && multiUser.server.serverId) || null,
                serverName: serverInfo.Name || (multiUser.server && multiUser.server.serverName) || null,
                baseurl: (apiClient && typeof apiClient.serverAddress === 'function' ? apiClient.serverAddress() : null) || (multiUser.server && multiUser.server.baseurl) || null,
                hosturl: (multiUser.server && multiUser.server.hosturl) || null
            };

            postMessage('multiUser.signedIn', payload);
            return Promise.resolve(payload);
        },

        onLocalUserSignedOut: function (logoutInfo) {
            postMessage('multiUser.signedOut', {
                logoutInfo: logoutInfo || null,
                sessionId: multiUser.activeSession ? multiUser.activeSession.id : null
            });

            return Promise.resolve(logoutInfo || {});
        },

        getMultiUserContext: function () {
            return multiUser;
        },

        downloadFile: function (url) {
            postMessage('downloadFile', { url: url });
        },

        enableFullscreen: function () {
            postMessage('enableFullscreen');
        },

        disableFullscreen: function () {
            postMessage('disableFullscreen');
        },

        getPlugins: function () {
            postMessage('getPlugins');
            return [];
        },

        openUrl: function (url, target) {
            postMessage('openUrl', {
                url: url,
                target: target
            });
        },

        updateMediaSession: function (mediaInfo) {
            postMessage('updateMediaSession', { mediaInfo: mediaInfo });
        },

        hideMediaSession: function () {
            postMessage('hideMediaSession');
        }
    };
})(window.AppInfo, window.DeviceInfo);
