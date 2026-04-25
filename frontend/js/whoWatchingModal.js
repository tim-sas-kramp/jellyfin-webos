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
    var PIN_MIN_LENGTH = 4;
    var PIN_MAX_LENGTH = 6;

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

    function isDigit(value) {
        return /^[0-9]$/.test(String(value));
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
        this.pinPromptOptions = {};
        this.pinValue = '';
        this.pinSubmitting = false;
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
        this.clearPinPromptState();
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
        if (this.isPinPromptVisible()) {
            var pinPrompt = this.getPinPromptElement();
            var pinButton = pinPrompt && pinPrompt.querySelector('button');
            if (pinButton) {
                pinButton.focus();
            }
            return;
        }

        var first = this.root.querySelector('button');
        if (first) {
            first.focus();
        }
    };

    WhoWatchingModal.prototype.setPinPromptError = function (message) {
        var errorNode = this.getPinPromptElement() && this.getPinPromptElement().querySelector('.who-inline-pin-error');
        this.pinPromptOptions.error = message || '';

        if (!errorNode) {
            return;
        }

        if (!message) {
            errorNode.style.display = 'none';
            errorNode.innerText = '';
            return;
        }

        errorNode.innerText = message;
        errorNode.style.display = '';
    };

    WhoWatchingModal.prototype.isPinPromptVisible = function () {
        return !!(this.pinPromptOptions && this.pinPromptOptions.accountId);
    };

    WhoWatchingModal.prototype.isPinPromptForAccount = function (account) {
        return !!(account && this.pinPromptOptions && this.pinPromptOptions.accountId === account.accountId);
    };

    WhoWatchingModal.prototype.getAccountById = function (accountId) {
        var accounts = this.options.accounts || [];

        for (var i = 0; i < accounts.length; i++) {
            if (accounts[i].accountId === accountId) {
                return accounts[i];
            }
        }

        return null;
    };

    WhoWatchingModal.prototype.getFocusedAccount = function () {
        var node = this.document.activeElement;
        var accountId;

        while (node && node !== this.root) {
            if (node.getAttribute) {
                accountId = node.getAttribute('data-account-id');
                if (accountId) {
                    return this.getAccountById(accountId);
                }
            }

            node = node.parentNode;
        }

        return null;
    };

    WhoWatchingModal.prototype.selectFocusedAccount = function () {
        var account = this.getFocusedAccount();

        if (account && this.options.onSelectAccount) {
            this.options.onSelectAccount(account);
        }

        return account;
    };

    WhoWatchingModal.prototype.getPinPromptElement = function () {
        return this.root ? this.root.querySelector('.who-inline-pin') : null;
    };

    WhoWatchingModal.prototype.getPinMinLength = function () {
        return this.pinPromptOptions.minLength || PIN_MIN_LENGTH;
    };

    WhoWatchingModal.prototype.getPinMaxLength = function () {
        return this.pinPromptOptions.maxLength || PIN_MAX_LENGTH;
    };

    WhoWatchingModal.prototype.getPinAutoLength = function () {
        var autoLength = parseInt(this.pinPromptOptions.autoLength, 10);

        if (autoLength >= this.getPinMinLength() && autoLength <= this.getPinMaxLength()) {
            return autoLength;
        }

        return null;
    };

    WhoWatchingModal.prototype.updatePinDisplay = function () {
        var display = this.getPinPromptElement() && this.getPinPromptElement().querySelector('.who-inline-pin-display');

        if (!display) {
            return;
        }

        var parts = [];
        for (var i = 0; i < this.pinValue.length; i++) {
            parts.push('*');
        }

        display.innerText = parts.join(' ');
    };

    WhoWatchingModal.prototype.updatePinConfirmState = function () {
        var autoLength = this.getPinAutoLength();
        var button = this.getPinPromptElement() && this.getPinPromptElement().querySelector('.who-inline-pin-confirm');

        if (!button) {
            return;
        }

        if (autoLength) {
            button.style.display = 'none';
            button.disabled = true;
            return;
        }

        button.style.display = '';
        button.disabled = this.pinValue.length < this.getPinMinLength();
    };

    WhoWatchingModal.prototype.clearPinValue = function () {
        this.pinValue = '';
        this.updatePinDisplay();
        this.updatePinConfirmState();
        this.focusFirst();
    };

    WhoWatchingModal.prototype.removePinDigit = function () {
        this.pinValue = this.pinValue.slice(0, -1);
        this.updatePinDisplay();
        this.updatePinConfirmState();
    };

    WhoWatchingModal.prototype.appendPinDigit = function (digit) {
        if (!isDigit(digit) || this.pinSubmitting || this.pinValue.length >= this.getPinMaxLength()) {
            return;
        }

        this.pinValue += String(digit);
        this.setPinPromptError();
        this.updatePinDisplay();
        this.updatePinConfirmState();

        if (this.getPinAutoLength() && this.pinValue.length >= this.getPinAutoLength()) {
            this.submitPinPrompt();
        } else if (!this.getPinAutoLength() && this.pinValue.length >= this.getPinMaxLength()) {
            this.submitPinPrompt();
        }
    };

    WhoWatchingModal.prototype.submitPinPrompt = function () {
        var result = true;

        if (this.pinSubmitting) {
            return false;
        }

        if (this.pinValue.length < this.getPinMinLength() || this.pinValue.length > this.getPinMaxLength()) {
            this.setPinPromptError(this.pinPromptOptions.formatError || 'PIN must be 4 to 6 digits.');
            this.clearPinValue();
            return false;
        }

        this.pinSubmitting = true;

        if (this.pinPromptOptions.onSubmit) {
            result = this.pinPromptOptions.onSubmit(this.pinValue);
        }

        if (typeof result === 'string') {
            this.pinSubmitting = false;
            this.setPinPromptError(result);
            this.clearPinValue();
            return false;
        }

        if (result === false) {
            this.pinSubmitting = false;
            return false;
        }

        this.pinSubmitting = false;
        this.hidePinPrompt();
        return true;
    };

    WhoWatchingModal.prototype.handlePinKeyCode = function (keyCode) {
        if (!this.isPinPromptVisible()) {
            return false;
        }

        if (keyCode >= 48 && keyCode <= 57) {
            this.appendPinDigit(keyCode - 48);
            return true;
        }

        if (keyCode >= 96 && keyCode <= 105) {
            this.appendPinDigit(keyCode - 96);
            return true;
        }

        if (keyCode === 8 || keyCode === 46) {
            this.removePinDigit();
            return true;
        }

        return false;
    };

    WhoWatchingModal.prototype.appendPinKeypad = function (container) {
        var self = this;

        if (!container) {
            return;
        }

        function addButton(label, className, onClick) {
            var button = self.document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.innerText = label;
            button.onclick = onClick;
            container.appendChild(button);
        }

        for (var i = 1; i <= 9; i++) {
            (function (digit) {
                addButton(String(digit), 'pin-key', function () {
                    self.appendPinDigit(digit);
                });
            })(i);
        }

        addButton('Clear', 'pin-key pin-key-action', function () {
            self.clearPinValue();
        });

        addButton('0', 'pin-key', function () {
            self.appendPinDigit(0);
        });

        addButton('Back', 'pin-key pin-key-action', function () {
            self.removePinDigit();
        });
    };

    WhoWatchingModal.prototype.showPinPrompt = function (options) {
        this.pinPromptOptions = options || {};
        this.pinPromptOptions.accountId = this.pinPromptOptions.accountId || (this.pinPromptOptions.account && this.pinPromptOptions.account.accountId);
        this.pinPromptOptions.minLength = this.pinPromptOptions.minLength || PIN_MIN_LENGTH;
        this.pinPromptOptions.maxLength = this.pinPromptOptions.maxLength || PIN_MAX_LENGTH;
        this.pinValue = '';
        this.pinSubmitting = false;
        this.render();
        this.focusFirst();
    };

    WhoWatchingModal.prototype.clearPinPromptState = function () {
        this.pinPromptOptions = {};
        this.pinValue = '';
        this.pinSubmitting = false;
    };

    WhoWatchingModal.prototype.hidePinPrompt = function () {
        var wasVisible = this.isPinPromptVisible();

        this.clearPinPromptState();

        if (wasVisible && this.root && this.root.style.display !== 'none') {
            this.render();
            this.focusFirst();
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
            self.clearPinPromptState();
            self.manageMode = !self.manageMode;
            self.render();
            self.focusFirst();
        };

        this.changeServerButton.onclick = function () {
            if (self.options.onChangeServer) {
                self.options.onChangeServer();
            }
        };

        if (this.isPinPromptVisible()) {
            this.updatePinDisplay();
            this.updatePinConfirmState();
            this.setPinPromptError(this.pinPromptOptions.error);
        }
    };

    WhoWatchingModal.prototype.createAccountTile = function (account) {
        var self = this;

        if (this.isPinPromptForAccount(account)) {
            return this.createPinAccountCard(account);
        }

        if (this.manageMode) {
            return this.createManageAccountCard(account);
        }

        var tile = this.document.createElement('button');
        tile.className = 'who-account-tile who-user-tile';
        tile.type = 'button';
        tile.setAttribute('data-account-id', account.accountId);

        this.appendAccountContent(tile, account);

        tile.onclick = function () {
            if (self.options.onSelectAccount) {
                self.options.onSelectAccount(account);
            }
        };

        return tile;
    };

    WhoWatchingModal.prototype.createPinAccountCard = function (account) {
        var card = this.document.createElement('div');
        card.className = 'who-account-tile who-pin-card' + (this.manageMode ? ' who-manage-card' : '');
        card.setAttribute('data-account-id', account.accountId);

        this.appendAccountContent(card, account);
        this.appendInlinePinPrompt(card, account);

        return card;
    };

    WhoWatchingModal.prototype.appendInlinePinPrompt = function (card, account) {
        var self = this;
        var prompt = this.document.createElement('div');
        prompt.className = 'who-inline-pin';

        var error = this.document.createElement('div');
        error.className = 'who-error who-inline-pin-error';
        error.style.display = 'none';
        prompt.appendChild(error);

        var display = this.document.createElement('div');
        display.className = 'pin-display who-inline-pin-display';
        display.setAttribute('aria-live', 'polite');
        prompt.appendChild(display);

        var keypad = this.document.createElement('div');
        keypad.className = 'pin-keypad who-inline-pin-keypad';
        keypad.setAttribute('aria-label', 'PIN keypad');
        this.appendPinKeypad(keypad);
        prompt.appendChild(keypad);

        var actions = this.document.createElement('div');
        actions.className = 'who-actions who-inline-pin-actions';

        var confirmButton = this.document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'who-inline-pin-confirm';
        confirmButton.innerText = this.pinPromptOptions.buttonText || 'Continue';
        confirmButton.onclick = function () {
            self.submitPinPrompt();
        };
        actions.appendChild(confirmButton);

        var cancelButton = this.document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'who-inline-pin-cancel';
        cancelButton.innerText = 'Cancel';
        cancelButton.onclick = function () {
            var onCancel = self.pinPromptOptions.onCancel;
            self.hidePinPrompt();
            if (onCancel) {
                onCancel();
            }
        };
        actions.appendChild(cancelButton);

        prompt.appendChild(actions);
        card.appendChild(prompt);

        this.updatePinDisplay();
        this.updatePinConfirmState();
        this.setPinPromptError(this.pinPromptOptions.error);
    };

    WhoWatchingModal.prototype.appendAccountContent = function (tile, account) {

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
        if (this.isPinPromptForAccount(account)) {
            detail.style.display = 'none';
            detail.innerText = '';
        } else if (account.needsReauth) {
            detail.innerText = 'Sign in again';
        } else if (account.pinProtected) {
            detail.innerText = 'PIN required';
        } else {
            detail.innerText = formatLastUsed(account.lastUsedAt);
        }
        tile.appendChild(detail);
    };

    WhoWatchingModal.prototype.createManageAccountCard = function (account) {
        var self = this;
        var card = this.document.createElement('div');
        card.className = 'who-account-tile who-manage-card';
        card.setAttribute('data-account-id', account.accountId);

        this.appendAccountContent(card, account);

        var actions = this.document.createElement('div');
        actions.className = 'who-tile-actions';

        var pinButton = this.document.createElement('button');
        pinButton.type = 'button';
        pinButton.innerText = account.pinProtected ? 'Change PIN' : 'Set PIN';
        pinButton.onclick = function () {
            if (self.options.onSetPin) {
                self.options.onSetPin(account);
            }
        };
        actions.appendChild(pinButton);

        if (account.pinProtected) {
            var clearButton = this.document.createElement('button');
            clearButton.type = 'button';
            clearButton.innerText = 'Clear PIN';
            clearButton.onclick = function () {
                if (self.options.onClearPin) {
                    self.options.onClearPin(account);
                }
            };
            actions.appendChild(clearButton);
        }

        var removeButton = this.document.createElement('button');
        removeButton.type = 'button';
        removeButton.innerText = 'Remove';
        removeButton.onclick = function () {
            if (self.options.onRemoveAccount) {
                self.options.onRemoveAccount(account);
            }
        };
        actions.appendChild(removeButton);

        card.appendChild(actions);
        return card;
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
