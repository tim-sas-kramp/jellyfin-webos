/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
*/

const assert = require('node:assert/strict');

const { AccountStore } = require('../frontend/js/accountStore.js');
const AccountAuth = require('../frontend/js/accountAuth.js');
const { getWhoWatchingViewModel } = require('../frontend/js/whoWatchingModal.js');

function createStorage() {
    const data = {};
    return {
        get(name) {
            return data[name];
        },
        set(name, value) {
            data[name] = JSON.parse(JSON.stringify(value));
            return value;
        },
        remove(name) {
            delete data[name];
        },
        raw() {
            return data;
        }
    };
}

function server(id, address) {
    return {
        id,
        Name: `Server ${id}`,
        baseurl: address || `http://${id}.example:8096`
    };
}

function user(id, name) {
    return {
        Id: id,
        Name: name || `User ${id}`,
        PrimaryImageTag: `tag-${id}`
    };
}

function createAjax(outcome) {
    return {
        lastRequest: null,
        request(url, settings) {
            this.lastRequest = { url, settings };
            if (outcome.type === 'success') {
                settings.success(outcome.body);
            } else if (outcome.type === 'error') {
                settings.error({ error: outcome.status });
            } else if (outcome.type === 'abort') {
                settings.abort({ error: 'abort' });
            }
            return { abort() {} };
        }
    };
}

function createLocalStorage(initial) {
    const data = { ...(initial || {}) };
    return {
        get length() {
            return Object.keys(data).length;
        },
        key(index) {
            return Object.keys(data)[index] || null;
        },
        getItem(name) {
            return Object.prototype.hasOwnProperty.call(data, name) ? data[name] : null;
        },
        setItem(name, value) {
            data[name] = String(value);
        },
        removeItem(name) {
            delete data[name];
        },
        raw() {
            return data;
        }
    };
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        console.error(`not ok - ${name}`);
        throw err;
    }
}

test('account store creates, updates, lists, and removes accounts', () => {
    const store = new AccountStore(createStorage());
    const account = store.saveAuthenticatedAccount(server('s1'), user('u1', 'Alice'), 'token-a', 'device-a');

    assert.equal(account.accountId, 's1:u1');
    assert.equal(account.needsReauth, false);
    assert.equal(store.listForServer('s1').length, 1);

    const updated = store.saveAuthenticatedAccount(server('s1'), user('u1', 'Alice B'), 'token-b', 'device-b');
    assert.equal(updated.userName, 'Alice B');
    assert.equal(updated.accessToken, 'token-b');
    assert.equal(updated.deviceId, 'device-a');

    store.removeAccount('s1', 's1:u1');
    assert.equal(store.listForServer('s1').length, 0);
});

test('account store isolates accounts per server', () => {
    const store = new AccountStore(createStorage());
    store.saveAuthenticatedAccount(server('s1'), user('u1'), 'token-a', 'device-a');
    store.saveAuthenticatedAccount(server('s2'), user('u1'), 'token-b', 'device-b');

    assert.equal(store.listForServer('s1').length, 1);
    assert.equal(store.listForServer('s2').length, 1);
    assert.equal(store.listForServer('missing').length, 0);
});

test('who watching view model always shows modal for zero, one, or many accounts', () => {
    assert.equal(getWhoWatchingViewModel([]).alwaysShow, true);
    assert.equal(getWhoWatchingViewModel([]).showEmptyState, true);
    assert.equal(getWhoWatchingViewModel([{ accountId: 'a' }]).alwaysShow, true);
    assert.equal(getWhoWatchingViewModel([{ accountId: 'a' }]).showManage, true);
    assert.equal(getWhoWatchingViewModel([{ accountId: 'a' }, { accountId: 'b' }]).tiles.length, 3);
});

test('auto connect skips only server selection, never account selection', () => {
    const view = getWhoWatchingViewModel([{ accountId: 'a' }]);
    assert.equal(view.alwaysShow, true);
    assert.equal(view.tiles.some((tile) => tile.type === 'add'), true);
});

test('selected account and reauth transitions are persisted', () => {
    const store = new AccountStore(createStorage());
    const account = store.saveAuthenticatedAccount(server('s1'), user('u1'), 'token-a', 'device-a');

    store.setSelectedAccount('s1', account.accountId);
    assert.equal(store.getSelectedAccount('s1').accountId, account.accountId);

    const invalid = store.markNeedsReauth('s1', account.accountId);
    assert.equal(invalid.accessToken, null);
    assert.equal(invalid.needsReauth, true);
});

test('per-account device id remains stable across token updates', () => {
    const store = new AccountStore(createStorage());
    store.saveAuthenticatedAccount(server('s1'), user('u1'), 'token-a', 'device-a');
    const updated = store.saveAuthenticatedAccount(server('s1'), user('u1'), 'token-b', 'device-b');

    assert.equal(updated.deviceId, 'device-a');
    assert.match(AccountStore.generateDeviceId({ getRandomValues: (bytes) => bytes.fill(1) }), /^webos-/);
});

test('jellyfin web credential merge replaces selected server and preserves others', () => {
    const existing = {
        Servers: [
            { Id: 's1', AccessToken: 'old' },
            { Id: 's2', AccessToken: 'keep' }
        ]
    };
    const credential = AccountAuth.createJellyfinWebServerCredential(server('s1'), {
        userId: 'u1',
        accessToken: 'new'
    }, 123);
    const merged = AccountAuth.mergeJellyfinWebCredential(existing, credential);

    assert.equal(merged.Servers.length, 2);
    assert.equal(merged.Servers[0].AccessToken, 'new');
    assert.equal(merged.Servers[1].AccessToken, 'keep');
});

test('credential seeding clears old token before Jellyfin Web starts', () => {
    const localStorage = createLocalStorage({
        jellyfin_credentials: JSON.stringify({
            Servers: [
                { Id: 's1', AccessToken: 'old-token', UserId: 'old-user' },
                { Id: 's2', AccessToken: 'keep-token', UserId: 'keep-user' }
            ]
        }),
        'user-old-user-s1': JSON.stringify({ Name: 'Old User' }),
        'user-keep-user-s2': JSON.stringify({ Name: 'Keep User' })
    });
    const credential = AccountAuth.createJellyfinWebServerCredential(server('s1'), null, 123);
    const seeded = AccountAuth.seedJellyfinWebCredentials(localStorage, credential);

    assert.equal(seeded.Servers.length, 2);
    assert.equal(seeded.Servers[0].Id, 's1');
    assert.equal(seeded.Servers[0].AccessToken, null);
    assert.equal(seeded.Servers[0].UserId, null);
    assert.equal(seeded.Servers[1].AccessToken, 'keep-token');
    assert.equal(localStorage.getItem('user-old-user-s1'), null);
    assert.notEqual(localStorage.getItem('user-keep-user-s2'), null);
});

test('credential seed url uses server origin instead of Jellyfin Web app', () => {
    const url = AccountAuth.createCredentialSeedUrl(server('s1', 'http://server.example:8096'), 'abc 123');

    assert.equal(url, 'http://server.example:8096/System/Info/Public?jf_webos_credential_seed=abc%20123');
});

test('token validation succeeds and sends Jellyfin auth headers', () => {
    const ajax = createAjax({ type: 'success', body: user('u1', 'Alice') });
    let validatedUser = null;

    AccountAuth.validateToken(ajax, server('s1'), {
        userId: 'u1',
        accessToken: 'token-a',
        deviceId: 'device-a'
    }, {
        appName: 'Jellyfin for WebOS',
        appVersion: '1.2.2',
        deviceName: 'LG Smart TV'
    }, {
        success(result) {
            validatedUser = result;
        }
    });

    assert.equal(validatedUser.Name, 'Alice');
    assert.equal(ajax.lastRequest.url, 'http://s1.example:8096/Users/u1');
    assert.equal(ajax.lastRequest.settings.headers['X-Emby-Token'], 'token-a');
    assert.match(ajax.lastRequest.settings.headers.Authorization, /DeviceId="device-a"/);
});

test('token validation classifies revoked and network failures', () => {
    assert.equal(AccountAuth.classifyValidationFailure({ error: 401 }), 'revoked');
    assert.equal(AccountAuth.classifyValidationFailure({ error: 403 }), 'revoked');
    assert.equal(AccountAuth.classifyValidationFailure({ error: 'timeout' }), 'network');
    assert.equal(AccountAuth.classifyValidationFailure({ error: 503 }), 'network');
    assert.equal(AccountAuth.classifyValidationFailure({ error: 404 }), 'invalid');
});

test('sign-in capture stores password, passwordless, and quick connect style auth results', () => {
    const store = new AccountStore(createStorage());
    const signInResults = [
        { User: user('u1', 'Password'), AccessToken: 'token-password' },
        { User: user('u2', 'Passwordless'), AccessToken: 'token-passwordless' },
        { User: user('u3', 'Quick Connect'), AccessToken: 'token-quickconnect' }
    ];

    signInResults.forEach((result, index) => {
        store.saveAuthenticatedAccount(server('s1'), result.User, result.AccessToken, `device-${index}`);
    });

    const accounts = store.listForServer('s1');
    assert.equal(accounts.length, 3);
    assert.equal(accounts.some((account) => account.userName === 'Quick Connect'), true);
});

test('logout clears only the current remembered token', () => {
    const store = new AccountStore(createStorage());
    const first = store.saveAuthenticatedAccount(server('s1'), user('u1'), 'token-a', 'device-a');
    const second = store.saveAuthenticatedAccount(server('s1'), user('u2'), 'token-b', 'device-b');

    store.markNeedsReauth('s1', first.accountId);

    const accounts = store.listForServer('s1');
    const cleared = accounts.filter((account) => account.accountId === first.accountId)[0];
    const untouched = accounts.filter((account) => account.accountId === second.accountId)[0];

    assert.equal(cleared.accessToken, null);
    assert.equal(cleared.needsReauth, true);
    assert.equal(untouched.accessToken, 'token-b');
    assert.equal(untouched.needsReauth, false);
});
