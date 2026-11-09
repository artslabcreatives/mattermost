import React, {useEffect, useRef} from 'react';

import {SNOWFLAKE_PATH} from './artwork';

// Icy whites, blues and lavender; a soft blue shadow keeps white flakes visible on light themes.
const COLORS = ['#ffffff', '#e3f4ff', '#bfe3fb', '#94cdf3', '#d6dcff', '#c4f1f9'];
const SPRITE = 64;
const GLYPH = 48; // The 16-unit snowflake is drawn 48px wide inside each 64px sprite.

interface Flake {x: number; y: number; size: number; speed: number; sway: number; phase: number; angle: number; spin: number; sprite: number; alpha: number}

function makeSprites(): HTMLCanvasElement[] {
    const path = new Path2D(SNOWFLAKE_PATH);
    return COLORS.map((color) => {
        const sprite = document.createElement('canvas');
        sprite.width = SPRITE;
        sprite.height = SPRITE;
        const ctx = sprite.getContext('2d');
        if (ctx) {
            ctx.translate((SPRITE - GLYPH) / 2, (SPRITE - GLYPH) / 2);
            ctx.scale(GLYPH / 16, GLYPH / 16);
            ctx.shadowColor = 'rgba(56, 108, 160, 0.55)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = color;
            ctx.fill(path);
            ctx.shadowColor = 'transparent';
            ctx.strokeStyle = 'rgba(70, 120, 170, 0.35)';
            ctx.lineWidth = 0.25;
            ctx.stroke(path);
        }
        return sprite;
    });
}

export default function Snow({density}: {density: number}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const element = canvas.current;
        const ctx = element?.getContext('2d');
        if (!element || !ctx || density === 0) return undefined;
        const sprites = makeSprites();
        let width = 0;
        let height = 0;
        let dpr = 1;
        let frame = 0;
        let previous = 0;
        let flakes: Flake[] = [];
        const makeFlake = (y: number): Flake => {
            const r = Math.random();
            const size = 7 + r * r * 19; // Mostly small flakes, with a few large ones up front.
            return {
                x: Math.random() * width, y, size,
                speed: 16 + size * 2.2 + Math.random() * 14,
                sway: 6 + Math.random() * 16,
                phase: Math.random() * Math.PI * 2,
                angle: Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 1.4,
                sprite: Math.floor(Math.random() * sprites.length),
                alpha: 0.55 + Math.random() * 0.4,
            };
        };
        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            element.width = width * dpr;
            element.height = height * dpr;
            const budget = (navigator.hardwareConcurrency || 4) <= 4 ? 0.65 : 1;
            const count = Math.round(density * Math.min(1, width / 1440) * budget);
            flakes = Array.from({length: count}, () => makeFlake(Math.random() * height));
        };
        const draw = (time: number) => {
            const dt = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
            previous = time;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, element.width, element.height);
            flakes.forEach((flake, index) => {
                flake.y += flake.speed * dt;
                flake.x += (5 + Math.sin(time / 2100 + flake.phase) * flake.sway) * dt;
                flake.angle += flake.spin * dt;
                if (flake.y > height + flake.size) flakes[index] = flake = makeFlake(-flake.size);
                if (flake.x > width + flake.size) flake.x = -flake.size;
                if (flake.x < -flake.size) flake.x = width + flake.size;
                const cos = Math.cos(flake.angle) * dpr;
                const sin = Math.sin(flake.angle) * dpr;
                const drawn = flake.size * SPRITE / GLYPH;
                ctx.globalAlpha = flake.alpha;
                ctx.setTransform(cos, sin, -sin, cos, flake.x * dpr, flake.y * dpr);
                ctx.drawImage(sprites[flake.sprite], -drawn / 2, -drawn / 2, drawn, drawn);
            });
            frame = requestAnimationFrame(draw);
        };
        resize();
        window.addEventListener('resize', resize);
        frame = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, element.width, element.height);
        };
    }, [density]);
    return <canvas ref={canvas} className='cm-snow' aria-hidden='true'/>;
}
