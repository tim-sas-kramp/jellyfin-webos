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

    root.WhoWatchingModal = exported.WhoWatchingModal;
    root.getWhoWatchingViewModel = exported.getWhoWatchingViewModel;
})(typeof self !== 'undefined' ? self : this, function () {
    function getWhoWatchingViewModel(accounts) {
        accounts = accounts || [];

        return {
            accountCount: accounts.length,
            alwaysShow: true,
            showEmptyState: accounts.length === 0,
            showManage: accounts.length > 0,
            tiles: accounts.concat([{ type: 'add' }])
        };
    }

    function formatLastUsed(timestamp) {
        if (!timestamp) {
            return 'Not used yet';
        }

        var diff = Math.max(0, new Date().getTime() - timestamp);
        var minutes = Math.floor(diff / 60000);

        if (minutes < 1) {
            return 'Just now';
        }

        if (minutes < 60) {
            return minutes + ' min ago';
        }

        var hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return hours + ' hr ago';
        }

        var days = Math.floor(hours / 24);
        return days + ' day' + (days === 1 ? '' : 's') + ' ago';
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function WhoWatchingModal(documentRef) {
        this.document = documentRef;
        this.root = documentRef.getElementById('whoWatchingModal');
        this.title = documentRef.getElementById('whoWatchingTitle');
        this.subtitle = documentRef.getElementById('whoWatchingSubtitle');
        this.grid = documentRef.getElementById('whoWatchingAccounts');
        this.error = documentRef.getElementById('whoWatchingError');
        this.manageButton = documentRef.getElementById('manageAccounts');
        this.changeServerButton = documentRef.getElementById('changeServer');
        this.manageMode = false;
        this.options = {};
    }

    WhoWatchingModal.prototype.show = function (options) {
        this.options = options || {};
        this.manageMode = false;
        this.render();
        this.root.style.display = '';
        this.root.setAttribute('aria-hidden', 'false');
        this.focusFirst();
    };

    WhoWatchingModal.prototype.hide = function () {
        this.root.style.display = 'none';
        this.root.setAttribute('aria-hidden', 'true');
    };

    WhoWatchingModal.prototype.setError = function (message) {
        if (!message) {
            this.error.style.display = 'none';
            this.error.innerText = '';
            return;
        }

        this.error.innerText = message;
        this.error.style.display = '';
    };

    WhoWatchingModal.prototype.focusFirst = function () {
        var first = this.root.querySelector('button');
        if (first) {
            first.focus();
        }
    };

    WhoWatchingModal.prototype.render = function () {
        var self = this;
        var accounts = this.options.accounts || [];
        var server = this.options.server || {};
        var viewModel = getWhoWatchingViewModel(accounts);

        this.title.innerText = "Who's watching?";
        this.subtitle.innerText = server.Name || server.ServerName || 'Select a Jellyfin account';
        this.setError(this.options.error);
        clear(this.grid);

        if (viewModel.showEmptyState) {
            var empty = this.document.createElement('div');
            empty.className = 'who-empty';
            empty.innerText = 'Add an account to start watching on this TV.';
            this.grid.appendChild(empty);
        }

        for (var i = 0; i < accounts.length; i++) {
            this.grid.appendChild(this.createAccountTile(accounts[i]));
        }

        this.grid.appendChild(this.createAddTile());

        this.manageButton.style.display = viewModel.showManage ? '' : 'none';
        this.manageButton.innerText = this.manageMode ? 'Done' : 'Manage accounts';
        this.manageButton.onclick = function () {
            self.manageMode = !self.manageMode;
            self.render();
            self.focusFirst();
        };

        this.changeServerButton.onclick = function () {
            if (self.options.onChangeServer) {
                self.options.onChangeServer();
            }
        };
    };

    WhoWatchingModal.prototype.createAccountTile = function (account) {
        var self = this;
        var tile = this.document.createElement('button');
        tile.className = 'who-account-tile';
        tile.type = 'button';

        var avatar = this.document.createElement('div');
        avatar.className = 'who-avatar';
        avatar.innerText = (account.userName || '?').charAt(0).toUpperCase();
        tile.appendChild(avatar);

        var name = this.document.createElement('div');
        name.className = 'who-name';
        name.innerText = account.userName || 'Unknown user';
        tile.appendChild(name);

        var detail = this.document.createElement('div');
        detail.className = account.needsReauth ? 'who-detail who-warning' : 'who-detail';
        detail.innerText = account.needsReauth ? 'Sign in again' : formatLastUsed(account.lastUsedAt);
        tile.appendChild(detail);

        if (this.manageMode) {
            tile.onclick = function () {
                if (self.options.onRemoveAccount) {
                    self.options.onRemoveAccount(account);
                }
            };
        } else {
            tile.onclick = function () {
                if (self.options.onSelectAccount) {
                    self.options.onSelectAccount(account);
                }
            };
        }

        return tile;
    };

    WhoWatchingModal.prototype.createAddTile = function () {
        var self = this;
        var tile = this.document.createElement('button');
        tile.className = 'who-account-tile who-add-tile';
        tile.type = 'button';

        var avatar = this.document.createElement('div');
        avatar.className = 'who-avatar';
        avatar.innerText = '+';
        tile.appendChild(avatar);

        var name = this.document.createElement('div');
        name.className = 'who-name';
        name.innerText = 'Add account';
        tile.appendChild(name);

        var detail = this.document.createElement('div');
        detail.className = 'who-detail';
        detail.innerText = 'Sign in';
        tile.appendChild(detail);

        tile.onclick = function () {
            if (self.options.onAddAccount) {
                self.options.onAddAccount();
            }
        };

        return tile;
    };

    return {
        WhoWatchingModal: WhoWatchingModal,
        getWhoWatchingViewModel: getWhoWatchingViewModel
    };
});
