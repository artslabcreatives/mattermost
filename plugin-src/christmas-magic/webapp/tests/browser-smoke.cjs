// Runs against the built plugin and a small Mattermost registry/header fixture.
// CHROME_BIN=/path/to/chrome node tests/browser-smoke.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');

const root = path.resolve(__dirname, '..');
const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('Set CHROME_BIN to a Chromium or Chrome executable.');
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const manifest = require('../../plugin.json');
const settings = Object.fromEntries(manifest.settings_schema.settings.map(({key, default: value}) => [key, value]));
settings.SantaMaxSeconds = 30;
settings.GiftGreetings = true;
const files = {
    '/react.js': 'node_modules/react/umd/react.development.js',
    '/react-dom.js': 'node_modules/react-dom/umd/react-dom.development.js',
    '/main.js': 'dist/main.js',
};
const savedWishes = [
    {id: 'w1', name: 'Ann', message: 'Peace and joy to everyone!', create_at: Date.UTC(2026, 11, 1)},
    {id: 'w2', name: 'Raj', message: 'Snow for Christmas, please.', create_at: Date.UTC(2026, 11, 2)},
];
const deletions = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/plugins/com.custom.christmas-magic/wishes' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(savedWishes));
    } else if (url.pathname.startsWith('/plugins/com.custom.christmas-magic/wishes') && req.method === 'DELETE') {
        deletions.push({path: url.pathname, csrf: req.headers['x-csrf-token']}); res.statusCode = 204; res.end();
    } else if (url.pathname === '/plugins/com.custom.christmas-magic/configuration') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(settings));
    } else if (files[url.pathname]) {
        res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(root, files[url.pathname])));
    } else {res.setHeader('Content-Type', 'text/html'); res.end(fixture);}
});

async function run(port, theme, width) {
    const outputDir = path.join(root, 'test-results');
    fs.mkdirSync(outputDir, {recursive: true});
    const browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
    try {
        const page = await browser.newPage({viewport: {width, height: 900}, deviceScaleFactor: 2});
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.clock.install();
        await page.goto(`http://127.0.0.1:${port}/?theme=${theme}`);
        await page.evaluate(() => {localStorage.clear(); plugin.initialize(registry, store);});
        await page.locator('.cm-snow').waitFor();
        const toggle = page.getByRole('switch', {name: 'Christmas animations'});
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        assert.equal(await page.locator('.cm-header-host').count(), 1);
        const sound = page.getByRole('switch', {name: 'Christmas sound'});
        assert.equal(await sound.getAttribute('aria-checked'), 'true');
        await sound.click();
        assert.equal(await sound.getAttribute('aria-checked'), 'false');
        assert.equal(await page.evaluate(() => localStorage.getItem('com.custom.christmas-magic:test-user:sound')), 'false');
        await sound.click();
        await page.evaluate(() => {HTMLMediaElement.prototype.play = function () {window.played = [...(window.played || []), this.src]; return Promise.resolve();};});
        const editor = page.getByRole('textbox', {name: 'Message input'});
        await editor.fill('Messages still work during Christmas magic.');
        assert.equal(await editor.inputValue(), 'Messages still work during Christmas magic.');
        assert.ok(await editor.evaluate((field) => {const rect = field.getBoundingClientRect(); return document.elementFromPoint(rect.x + 20, rect.y + 20) === field;}));
        await toggle.focus(); await page.keyboard.press('Space');
        await page.locator('.cm-effects').waitFor({state: 'detached'});
        assert.equal(await page.evaluate(() => localStorage.getItem('com.custom.christmas-magic:test-user:enabled')), 'false');
        await page.evaluate(() => plugin.uninitialize());
        await page.locator('.cm-header-host').waitFor({state: 'detached'});
        assert.equal(await page.evaluate(() => subscribers.size), 0);
        await page.evaluate(() => plugin.initialize(registry, store));
        await page.waitForFunction(() => switchButton() && !switchButton().disabled);
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        await toggle.focus(); await page.keyboard.press('Enter'); await page.locator('.cm-snow').waitFor();
        await page.evaluate(() => menuAction());
        await page.locator('.cm-effects').waitFor({state: 'detached'});
        await page.evaluate(() => menuAction()); await page.locator('.cm-snow').waitFor();
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.locator('.cm-effects').waitFor({state: 'detached'});
        assert.ok(await toggle.isDisabled());
        await page.emulateMedia({reducedMotion: 'no-preference'}); await page.locator('.cm-snow').waitFor();
        await page.evaluate(() => {Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));});
        await page.locator('.cm-effects').waitFor({state: 'detached'});
        await page.evaluate(() => {delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
        await page.locator('.cm-snow').waitFor();
        await page.evaluate((settings) => handler({data: {settings: {...settings, Enabled: false}}}), settings);
        await page.locator('.cm-effects').waitFor({state: 'detached'}); assert.ok(await toggle.isDisabled());
        await page.evaluate((settings) => handler({data: {settings}}), settings);
        await page.locator('.cm-snow').waitFor();
        await page.evaluate(() => {
            const old = document.querySelector('#RightControlsContainer');
            const replacement = document.createElement('div'); replacement.id = old.id;
            replacement.innerHTML = '<span>Saved</span><span>Settings</span><span>Profile</span>';
            old.replaceWith(replacement);
        });
        await page.waitForFunction(() => document.querySelector('#RightControlsContainer .cm-header-host'));
        assert.equal(await page.locator('.cm-header-host').count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width > 768) {
            assert.equal(await page.locator('.cm-snowman-lane .cm-snowman').count(), 1);
            await page.locator('.cm-snowman-hit').click({force: true}); // It is walking, so never "stable".
            await page.locator('.cm-snowman-lane.cm-fallen').waitFor();
            await page.evaluate(() => document.getAnimations().forEach((animation) => {if (animation.animationName === 'cm-slip' || animation.animationName === 'cm-dizzy-show') {animation.pause(); animation.currentTime = 1400;}}));
            const lane = await page.locator('.cm-snowman-walk').boundingBox();
            await page.screenshot({path: `${outputDir}/${theme}-${width}-snowman-slip.png`, clip: {x: lane.x - 40, y: lane.y - 10, width: 140, height: 90}, scale: 'device'});
            await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
            await page.clock.fastForward(3000);
            await page.locator('.cm-snowman-lane.cm-fallen').waitFor({state: 'detached'});
        }
        // Keep the snowfall varied, but force this flight to drop three gifts mid-screen.
        await page.evaluate(() => {Math.random = () => .5;});
        await page.clock.fastForward(30010);
        await page.locator('.cm-flight').waitFor();
        assert.equal(await page.locator('.cm-deer').count(), 2);
        await page.clock.fastForward(8000);
        assert.equal(await page.locator('.cm-gift').count(), 3);
        assert.deepEqual(await page.evaluate(() => window.played.map((src) => new URL(src).pathname)), ['/plugins/com.custom.christmas-magic/public/santa.wav']);
        // Seek the actual CSS animations to a visible mid-flight frame for review.
        await page.evaluate(() => document.getAnimations().forEach((animation) => {animation.pause(); animation.currentTime = 6500;}));
        await page.screenshot({path: `${outputDir}/${theme}-${width}.png`});
        if (width > 768) {
            await page.getByRole('button', {name: 'Open a Christmas gift'}).last().click(); // Gifts share one spot here; the last is on top.
            await page.locator('.cm-wish[role=status]').waitFor();
            assert.match(await page.locator('.cm-wish[role=status]').innerText(), /Congratulations, Sam![\s\S]*just kidding 😄/);
            await page.waitForTimeout(1700); // Let "just kidding" fade in before the screenshot.
            await page.screenshot({path: `${outputDir}/${theme}-${width}-wish.png`});
            await page.keyboard.press('Escape');
            await page.locator('.cm-wish[role=status]').waitFor({state: 'detached'});
        }
        // The 3D tree, a live /christmas wish in its bubble, then saved wishes taking turns.
        assert.equal(await page.locator('.cm-tree-lane .cm-tree-plane').count(), 4);
        await page.evaluate(() => handlers['custom_com.custom.christmas-magic_wish']({data: {wish: {id: 'live', name: 'Sam', message: 'A cosy Christmas to the whole team!', create_at: Date.now()}}}));
        await page.locator('.cm-wish-bubble', {hasText: 'A cosy Christmas to the whole team!'}).waitFor();
        assert.match(await page.locator('.cm-wish-bubble').innerText(), /Sam wishes/);
        await page.evaluate(() => document.getAnimations().forEach((animation) => {if (animation.animationName === 'cm-bubble') {animation.pause(); animation.currentTime = 1500;}}));
        const tree = await page.locator('.cm-tree-lane').boundingBox();
        await page.screenshot({path: `${outputDir}/${theme}-${width}-tree.png`, clip: {x: Math.max(0, tree.x - 250), y: tree.y - 70, width: Math.min(width, 350), height: 200}});
        await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
        // Saved wishes take turns; wait for one, then removing it clears the bubble at once.
        let saved;
        for (let turn = 0; turn < 6 && !saved; turn++) {
            await page.clock.fastForward(13000);
            const text = await page.locator('.cm-wish-bubble').innerText().catch(() => '');
            saved = savedWishes.find(({message}) => text.includes(message));
        }
        assert.ok(saved, 'a saved wish took a turn in the bubble');
        await page.evaluate((id) => handlers['custom_com.custom.christmas-magic_wishes_removed']({data: {id}}), saved.id);
        await page.locator('.cm-wish-bubble', {hasText: saved.message}).waitFor({state: 'detached'});
        if (width > 768) {
            // System Console list: newest first, removal sends Mattermost's CSRF token.
            await page.evaluate(() => {document.cookie = 'MMCSRF=csrf-123'; renderAdmin();});
            // The list reloads from the server, newest first.
            await page.waitForFunction(() => [...document.querySelectorAll('#admin tbody td:nth-child(2)')].map((cell) => cell.textContent).join('|') === 'Snow for Christmas, please.|Peace and joy to everyone!');
            await page.getByRole('button', {name: 'Remove wish from Ann'}).click();
            await page.waitForFunction(() => document.querySelectorAll('#admin tbody tr').length === 1);
            assert.deepEqual(deletions.pop(), {path: '/plugins/com.custom.christmas-magic/wishes/w1', csrf: 'csrf-123'});
            await page.evaluate(() => document.querySelector('#admin').remove());
        }
        await toggle.click(); await page.locator('.cm-effects').waitFor({state: 'detached'});
        await page.clock.fastForward(120000);
        assert.equal(await page.locator('.cm-effects').count(), 0);
        assert.deepEqual(errors, []);
        await page.evaluate(() => plugin.uninitialize());
        await page.locator('.cm-header-host').waitFor({state: 'detached'});
        console.log(`${theme}/${width}: PASS — keyboard switch, persistence, reduced motion, backgrounding, cleanup, admin settings, navigation, click-through, layout, Santa, sound, gifts, wishes, snowman, tree and admin wishes`);
    } finally {await browser.close();}
}

server.listen(0, '127.0.0.1', async () => {
    try {
        await run(server.address().port, 'light', 1440);
        await run(server.address().port, 'dark', 1440);
        await run(server.address().port, 'light', 600);
    } catch (error) {console.error(error); process.exitCode = 1;} finally {server.close();}
});
