/**
 * Generates the 1200x630 Open Graph preview image for collab.artslabcreatives.com.
 *
 * Run with Node 20 (node-canvas in webapp/node_modules is built for ABI 115):
 *   source ~/.nvm/nvm.sh && nvm use 20.11.1
 *   node make-og-image.js <repoRoot> <outFile>
 */

const path = require('path');

const REPO = process.argv[2] || '/var/www/mattermost-collab-prod';
const OUT = process.argv[3] || path.join(REPO, 'webapp/channels/src/images/og-image.png');

const {createCanvas, loadImage, registerFont} = require(path.join(REPO, 'webapp/node_modules/canvas'));

const LATO = '/usr/share/fonts/truetype/lato';
registerFont(path.join(LATO, 'Lato-Black.ttf'), {family: 'Lato', weight: '900'});
registerFont(path.join(LATO, 'Lato-Bold.ttf'), {family: 'Lato', weight: '700'});
registerFont(path.join(LATO, 'Lato-Semibold.ttf'), {family: 'Lato', weight: '600'});
registerFont(path.join(LATO, 'Lato-Regular.ttf'), {family: 'Lato', weight: '400'});

const W = 1200;
const H = 630;
const PAD = 84;

// Brand palette sampled from webapp/channels/src/images/logo.png
const BLUE = '#3870F8';
const BLUE_LIGHT = '#4090FF';

const TITLE = 'Artslab Internal';
const TITLE2 = 'Communicate';
const EYEBROW = 'ARTSLAB CREATIVES';
const SUBTITLE = 'Secure team messaging, files and collaboration — all in one place.';
const DOMAIN = 'collab.artslabcreatives.com';

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function main() {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Base gradient: deep navy -> indigo, on the diagonal ──────────
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#080D1A');
    bg.addColorStop(0.45, '#111A33');
    bg.addColorStop(1, '#1A2350');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Dot grid texture ─────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 40; y < H; y += 32) {
        for (let x = 40; x < W; x += 32) {
            ctx.beginPath();
            ctx.arc(x, y, 1.15, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ── Accent glows ─────────────────────────────────────────────────
    const glow = ctx.createRadialGradient(W - 150, 90, 0, W - 150, 90, 620);
    glow.addColorStop(0, 'rgba(56,112,248,0.42)');
    glow.addColorStop(0.55, 'rgba(56,112,248,0.10)');
    glow.addColorStop(1, 'rgba(56,112,248,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const glow2 = ctx.createRadialGradient(90, H - 40, 0, 90, H - 40, 520);
    glow2.addColorStop(0, 'rgba(64,144,255,0.20)');
    glow2.addColorStop(1, 'rgba(64,144,255,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // ── Logo (white lockup) ──────────────────────────────────────────
    const logo = await loadImage(path.join(REPO, 'webapp/channels/src/images/logoWhite.png'));
    const logoW = 236;
    const logoH = (logo.height / logo.width) * logoW;
    const logoY = PAD - 6;

    // The shipped "white" lockup is actually cream (#D8D4C4), which goes muddy
    // on navy — re-tint it to pure white through its own alpha.
    const tint = createCanvas(Math.ceil(logoW), Math.ceil(logoH));
    const tctx = tint.getContext('2d');
    tctx.drawImage(logo, 0, 0, logoW, logoH);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = '#FFFFFF';
    tctx.fillRect(0, 0, logoW, logoH);
    ctx.drawImage(tint, PAD, logoY);

    // Divider + eyebrow next to the logo
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD + logoW + 26, logoY + 2);
    ctx.lineTo(PAD + logoW + 26, logoY + logoH - 2);
    ctx.stroke();

    ctx.font = '600 19px Lato';
    ctx.fillStyle = 'rgba(196,208,235,0.85)';
    ctx.textBaseline = 'middle';
    const eyebrowX = PAD + logoW + 48;
    ctx.save();
    // letterspacing, drawn by hand: node-canvas has no letterSpacing
    let ex = eyebrowX;
    for (const ch of EYEBROW) {
        ctx.fillText(ch, ex, logoY + (logoH / 2) + 1);
        ex += ctx.measureText(ch).width + 2.2;
    }
    ctx.restore();

    // ── Title ────────────────────────────────────────────────────────
    ctx.textBaseline = 'alphabetic';
    ctx.font = '900 86px Lato';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 4;
    ctx.fillText(TITLE, PAD, 296);
    ctx.fillText(TITLE2, PAD, 296 + 96);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // ── Accent rule ──────────────────────────────────────────────────
    const ruleY = 296 + 96 + 46;
    const ruleGrad = ctx.createLinearGradient(PAD, 0, PAD + 132, 0);
    ruleGrad.addColorStop(0, BLUE_LIGHT);
    ruleGrad.addColorStop(1, BLUE);
    ctx.fillStyle = ruleGrad;
    roundRect(ctx, PAD, ruleY, 132, 7, 3.5);
    ctx.fill();

    // ── Subtitle ─────────────────────────────────────────────────────
    ctx.font = '400 30px Lato';
    ctx.fillStyle = '#AAB6D4';
    ctx.fillText(SUBTITLE, PAD, ruleY + 62);

    // ── Domain pill, bottom right ────────────────────────────────────
    ctx.font = '700 23px Lato';
    const dw = ctx.measureText(DOMAIN).width;
    const pillH = 52;
    const pillW = dw + 62;
    const pillX = W - PAD - pillW;
    const pillY = H - PAD - pillH + 14;

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.stroke();

    // little status dot
    ctx.fillStyle = BLUE_LIGHT;
    ctx.beginPath();
    ctx.arc(pillX + 26, pillY + (pillH / 2), 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#DDE5F7';
    ctx.textBaseline = 'middle';
    ctx.fillText(DOMAIN, pillX + 44, pillY + (pillH / 2) + 1);

    // ── Bottom accent bar ────────────────────────────────────────────
    const barGrad = ctx.createLinearGradient(0, 0, W, 0);
    barGrad.addColorStop(0, BLUE);
    barGrad.addColorStop(0.5, BLUE_LIGHT);
    barGrad.addColorStop(1, '#7B5CFF');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, H - 9, W, 9);

    require('fs').writeFileSync(OUT, canvas.toBuffer('image/png'));
    console.log('wrote', OUT);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
