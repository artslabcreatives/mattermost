const assert = require('node:assert/strict');
const {test, beforeEach} = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS},
    }).outputText, filename);
};
const {defaults, inSeason, normalizeSettings, parseGiftMessages, preferenceKey, soundKey} = require('../src/settings.ts');
const {Controller} = require('../src/controller.ts');

let media;
let storage;
let store;
let subscribers;
let timers;
let currentUserId;
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    media = Object.assign(new EventTarget(), {matches: false});
    storage = new Map();
    timers = new Set();
    global.window = Object.assign(new EventTarget(), {
        matchMedia: () => media,
        location: {origin: 'https://example.test'},
        setTimeout: (fn, ms) => {const timer = setTimeout(fn, ms); timers.add(timer); return timer;},
    });
    global.document = Object.assign(new EventTarget(), {hidden: false, cookie: ''});
    global.localStorage = {getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
    global.fetch = async () => ({ok: true, json: async () => defaults});
    currentUserId = 'alice';
    subscribers = new Set();
    store = {
        getState: () => ({entities: {users: {currentUserId}, general: {config: {SiteURL: 'https://example.test/collab'}}}}),
        subscribe: (fn) => {subscribers.add(fn); return () => subscribers.delete(fn);},
    };
});

test('schedule includes both endpoints and rejects invalid/reversed dates', () => {
    const cfg = {...defaults, StartDate: '2026-12-01', EndDate: '2026-12-31'};
    assert.equal(inSeason(cfg, new Date(2026, 11, 1)), true);
    assert.equal(inSeason(cfg, new Date(2026, 11, 31, 23, 59)), true);
    assert.equal(inSeason(cfg, new Date(2027, 0, 1)), false);
    assert.equal(inSeason({...cfg, StartDate: '2026-02-30'}), false);
    assert.equal(inSeason({...cfg, StartDate: '2027-01-01'}), false);
    assert.equal(normalizeSettings({SnowDensity: Infinity}).SnowDensity, 60);
    assert.equal(normalizeSettings({SnowDensity: 500}).SnowDensity, 150);
    assert.equal(normalizeSettings({SantaMinSeconds: 100, SantaMaxSeconds: 30}).SantaMaxSeconds, 100);
});

test('personal switch persists, honors administrator changes, and stops all effects', async (t) => {
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    assert.equal(controller.snapshot.active, true);
    controller.toggle();
    assert.equal(controller.snapshot.active, false);
    assert.equal(storage.get(preferenceKey('alice')), 'false');
    controller.receive({...defaults, Enabled: false}); controller.toggle();
    assert.equal(controller.snapshot.checked, false);
    controller.receive(defaults);
    assert.equal(controller.snapshot.active, false);
    controller.toggle();
    assert.equal(controller.snapshot.active, true);
});

test('visibility and reduced motion stop effects without losing the preference', async (t) => {
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(controller.snapshot.active, false); assert.equal(controller.snapshot.checked, true);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(controller.snapshot.active, true);
    media.matches = true; media.dispatchEvent(new Event('change'));
    assert.equal(controller.snapshot.checked, false); assert.match(controller.snapshot.reason, /reduced motion/);
    controller.toggle();
    media.matches = false; media.dispatchEvent(new Event('change'));
    assert.equal(controller.snapshot.active, true);
});

test('preferences are scoped by user and synchronize across tabs', async (t) => {
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    controller.toggle();
    currentUserId = 'bob'; subscribers.forEach((fn) => fn()); await tick();
    assert.equal(controller.snapshot.active, true);
    storage.set(preferenceKey('bob'), 'false');
    window.dispatchEvent(Object.assign(new Event('storage'), {key: preferenceKey('bob')}));
    assert.equal(controller.snapshot.active, false);
    currentUserId = ''; subscribers.forEach((fn) => fn());
    assert.equal(controller.snapshot.active, false);
});

test('greets the user by first name once their profile loads', async (t) => {
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    assert.equal(controller.snapshot.name, '');
    const getState = store.getState;
    store.getState = () => {const state = getState(); state.entities.users.profiles = {alice: {first_name: 'Alice', username: 'alice.w'}}; return state;};
    subscribers.forEach((fn) => fn());
    assert.equal(controller.snapshot.name, 'Alice');
    assert.equal(controller.snapshot.active, true);
});

test("Santa's sound follows the admin setting and each user's speaker button", async (t) => {
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    assert.equal(controller.snapshot.sound, true);
    assert.equal(controller.snapshot.soundUrl, '/collab/plugins/com.custom.christmas-magic/public/santa.wav');
    controller.toggleSound();
    assert.equal(controller.snapshot.sound, false);
    assert.equal(controller.snapshot.active, true);
    assert.equal(storage.get(soundKey('alice')), 'false');
    controller.toggleSound();
    controller.receive({...defaults, Sound: false});
    assert.equal(controller.snapshot.sound, false);
    controller.toggleSound();
    assert.equal(storage.get(soundKey('alice')), 'true');
    controller.receive(defaults); controller.toggle();
    assert.equal(controller.snapshot.sound, false);
});

test('gift messages are editable, with the built-in list as fallback', () => {
    assert.equal(parseGiftMessages(defaults.GiftMessages).length, 8);
    assert.deepEqual(parseGiftMessages('Cake in the kitchen! | Go now\n\n  Extra break  \nA | b | c'), [['Cake in the kitchen!', 'Go now'], ['Extra break', ''], ['A', 'b | c']]);
    assert.deepEqual(parseGiftMessages('  \n | only detail'), parseGiftMessages(defaults.GiftMessages));
    assert.equal(normalizeSettings({GiftMessages: 'Hi', JustKidding: false}).JustKidding, false);
});

test('wishes load, arrive live, and can be removed', async (t) => {
    global.fetch = async (url) => ({ok: true, json: async () => (String(url).endsWith('/wishes') ? [{id: 'a', name: 'Ann', message: 'Joy', create_at: 1}] : defaults)});
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick(); await tick();
    assert.deepEqual(controller.snapshot.wishes.map(({id}) => id), ['a']);
    controller.receiveWish({id: 'b', name: 'Bo', message: 'Snow', create_at: 2});
    controller.receiveWish({id: 'b', name: 'Bo', message: 'Snow', create_at: 2});
    assert.deepEqual(controller.snapshot.wishes.map(({id}) => id), ['a', 'b']);
    assert.equal(controller.snapshot.newWish.id, 'b');
    controller.removeWishes('b');
    assert.equal(controller.snapshot.newWish, null);
    controller.removeWishes('');
    assert.deepEqual(controller.snapshot.wishes, []);
});

test('a stale HTTP response cannot override a newer admin disable event', async (t) => {
    let resolve;
    global.fetch = () => new Promise((r) => {resolve = r;});
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start();
    controller.receive({...defaults, Enabled: false});
    resolve({ok: true, json: async () => defaults}); await tick();
    assert.equal(controller.snapshot.checked, false);
    assert.match(controller.snapshot.reason, /administrator/);
});

test('configuration errors fail closed, reconnect recovers, and cleanup detaches listeners', async () => {
    let requestedURL;
    global.fetch = async (url) => {requestedURL = url; throw new Error('offline');};
    const controller = new Controller(store); controller.start(); await tick();
    assert.equal(requestedURL, '/collab/plugins/com.custom.christmas-magic/configuration');
    assert.equal(controller.snapshot.active, false);
    global.fetch = async () => ({ok: true, json: async () => defaults});
    await controller.refresh(); assert.equal(controller.snapshot.active, true);
    controller.stop();
    assert.equal(subscribers.size, 0);
    assert.ok([...timers].every((timer) => timer._destroyed));
});

test('blocked browser storage does not break the personal switch', async (t) => {
    global.localStorage = {getItem() {throw Error('blocked');}, setItem() {throw Error('blocked');}};
    const controller = new Controller(store); t.after(() => controller.stop()); controller.start(); await tick();
    controller.toggle(); assert.equal(controller.snapshot.active, false);
    controller.toggle(); assert.equal(controller.snapshot.active, true);
});
