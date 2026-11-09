// Builds public/santa.wav: real sleigh bells and a synthesized "Jingle Bells" chorus played on
// bells, followed by Santa saying "Ho ho ho, Merry Christmas" (see README for sources):
//   https://commons.wikimedia.org/wiki/File:Sleigh_bells.wav (CC0)
//   freesound_community-santa-claus-merry-christmas-ho-ho-ho-103426.wav (supplied by the team)
// Usage: CHROME_BIN=/path/to/chrome node scripts/build-sound.cjs sleigh-bells.wav santa.wav ../public/santa.wav
const fs = require('node:fs');
const {chromium} = require('playwright-core');

const [bellsFile, santaFile, output] = process.argv.slice(2);
if (!process.env.CHROME_BIN || !output) throw new Error('Usage: CHROME_BIN=... node scripts/build-sound.cjs <sleigh-bells.wav> <santa.wav> <output.wav>');

async function render([bells, santa]) {
    const decode = (base64) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer);
    const [bellsBuffer, santaBuffer] = await Promise.all([decode(bells), decode(santa)]);
    const rate = 22050;
    const santaAt = 5.3;
    const length = santaAt + santaBuffer.duration + 0.3;
    const ctx = new OfflineAudioContext(1, Math.ceil(rate * length), rate);

    // Sleigh bells underneath, ducked while Santa speaks.
    const bed = ctx.createBufferSource();
    bed.buffer = bellsBuffer;
    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0, 0);
    bedGain.gain.linearRampToValueAtTime(3, 0.4); // The source recording is quiet (peaks near -23 dBFS).
    bedGain.gain.setValueAtTime(3, santaAt - 0.4);
    bedGain.gain.linearRampToValueAtTime(0.9, santaAt);
    bedGain.gain.linearRampToValueAtTime(0, length - 0.2);
    bed.connect(bedGain).connect(ctx.destination);
    bed.start(0);

    // "Jingle bells, jingle bells, jingle all the way" (E E E-, E E E-, E G C. D E---).
    const notes = [[659.25, 1], [659.25, 1], [659.25, 2], [659.25, 1], [659.25, 1], [659.25, 2], [659.25, 1], [783.99, 1], [523.25, 1.5], [587.33, 0.5], [659.25, 4]];
    const beat = 0.36;
    let time = 0.3;
    for (const [frequency, beats] of notes) {
        const ring = Math.min(1.4, beats * beat * 2.2);
        for (const [ratio, level] of [[1, 1], [2, 0.35], [3, 0.12], [4.2, 0.05]]) {
            const osc = ctx.createOscillator();
            osc.frequency.value = frequency * ratio;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.32 * level, time + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + ring / ratio ** 0.4);
            osc.connect(gain).connect(ctx.destination);
            osc.start(time);
            osc.stop(time + ring + 0.05);
        }
        time += beats * beat;
    }

    // Santa: "Ho ho ho, Merry Christmas", peak-matched to the melody.
    const voice = santaBuffer.getChannelData(0);
    const voicePeak = voice.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const speech = ctx.createBufferSource();
    speech.buffer = santaBuffer;
    const speechGain = ctx.createGain();
    speechGain.gain.value = 0.75 / voicePeak;
    speech.connect(speechGain).connect(ctx.destination);
    speech.start(santaAt);

    const data = (await ctx.startRendering()).getChannelData(0);
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const pcm = new Int16Array(data.length);
    data.forEach((value, i) => {pcm[i] = Math.round(value / peak * 0.89 * 32767);});
    const header = new DataView(new ArrayBuffer(44));
    const text = (offset, value) => [...value].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); header.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVEfmt ');
    header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
    header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
    text(36, 'data'); header.setUint32(40, pcm.byteLength, true);
    const bytes = new Uint8Array(44 + pcm.byteLength);
    bytes.set(new Uint8Array(header.buffer), 0);
    bytes.set(new Uint8Array(pcm.buffer), 44);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {wav: btoa(binary), peak};
}

(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROME_BIN});
    try {
        const page = await browser.newPage();
        const {wav, peak} = await page.evaluate(render, [bellsFile, santaFile].map((file) => fs.readFileSync(file).toString('base64')));
        fs.writeFileSync(output, Buffer.from(wav, 'base64'));
        console.log(`Wrote ${output} (${fs.statSync(output).size} bytes, source peak ${peak.toFixed(2)})`);
    } finally {await browser.close();}
})();
