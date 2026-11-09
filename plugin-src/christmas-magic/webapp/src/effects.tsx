import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Present, Sleigh, SLEIGH_DROP, SLEIGH_WIDTH} from './artwork';
import {chatFloor, type Style} from './chat_bar';
import {parseGiftMessages, type Settings, type Wish} from './settings';
import Snow from './snow';
import Snowman from './snowman';
import ChristmasTree, {TREE_WIDTH} from './tree';

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T, >(items: T[]) => items[Math.floor(Math.random() * items.length)];

const GIFT_COLORS: Array<[string, string]> = [['#d7263d', '#ffd166'], ['#2a9d6f', '#fff1c1'], ['#3a6fd8', '#ffe08a'], ['#8e5bd6', '#ffd6f0'], ['#e8a33d', '#c8102e']];
const GIFT_LIFETIME = 15000;
const WISH_LIFETIME = 10000;

interface Flight {id: number; start: number; duration: number; top: number; width: number; travel: number}
interface Gift {id: number; x: number; y: number; size: number; fall: number; drift: number; turn: number; drop: number; colors: [string, string]; opened: boolean; leaving: boolean}
interface RewardCard {id: number; x: number; y: number; reward: [string, string]}

let nextId = 0;

function createFlight(): Flight {
    const width = Math.min(SLEIGH_WIDTH, window.innerWidth * 0.7);
    return {
        id: ++nextId, start: performance.now(), duration: random(14000, 19000), width,
        travel: window.innerWidth + width * 2,
        top: random(60, Math.max(61, Math.min(window.innerHeight * 0.35, window.innerHeight - 320))),
    };
}

// Milliseconds into the flight at which the drop point passes the given viewport x.
function timeAt(flight: Flight, x: number): number {
    return (x + flight.width - SLEIGH_DROP.x * flight.width / SLEIGH_WIDTH) / flight.travel * flight.duration;
}

function dropGift(flight: Flight): Gift {
    const scale = flight.width / SLEIGH_WIDTH;
    const size = random(30, 42);
    const elapsed = performance.now() - flight.start;
    const x = -flight.width + flight.travel * elapsed / flight.duration + SLEIGH_DROP.x * scale - size / 2;
    const y = flight.top + SLEIGH_DROP.y * scale;
    const fall = Math.max(40, chatFloor() - y - size * 52 / 48);
    return {
        id: ++nextId, x, y, size, fall, drift: random(20, 70), turn: random(-40, 40),
        drop: Math.min(3400, Math.max(1600, 1200 + fall * 1.6)), colors: pick(GIFT_COLORS), opened: false, leaving: false,
    };
}

function useTimers() {
    const timers = useRef(new Set<number>());
    const clear = useCallback(() => {
        timers.current.forEach(clearTimeout);
        timers.current.clear();
    }, []);
    const later = useCallback((fn: () => void, ms: number) => {
        const id = window.setTimeout(() => {
            timers.current.delete(id);
            fn();
        }, ms);
        timers.current.add(id);
    }, []);
    useEffect(() => clear, [clear]);
    return {later, clear};
}

export default function Effects({settings, name, sound, soundUrl, wishes, newWish}: {settings: Settings; name: string; sound: boolean; soundUrl: string; wishes: Wish[]; newWish: Wish | null}) {
    const rewards = useMemo(() => parseGiftMessages(settings.GiftMessages), [settings.GiftMessages]);
    const [flight, setFlight] = useState<Flight | null>(null);
    const [gifts, setGifts] = useState<Gift[]>([]);
    const [wish, setWish] = useState<RewardCard | null>(null);
    const {later, clear} = useTimers();
    const audio = useRef<HTMLAudioElement | null>(null);
    const soundOn = useRef(sound);
    soundOn.current = sound;
    const playSound = useCallback(() => {
        if (!soundOn.current) return;
        audio.current ??= Object.assign(new Audio(soundUrl), {preload: 'auto', volume: 0.5});
        audio.current.currentTime = 0;
        // Browsers block audio until the user has interacted with the page; stay silent then.
        audio.current.play().catch(() => undefined);
    }, [soundUrl]);
    useEffect(() => {
        if (!sound) audio.current?.pause();
    }, [sound]);
    useEffect(() => () => audio.current?.pause(), []);

    useEffect(() => {
        setFlight(null);
        setGifts([]);
        setWish(null);
        if (!settings.Santa) return undefined;
        const schedule = () => later(() => {
            const next = createFlight();
            setFlight(next);
            later(playSound, 1500); // The bells fade in as the sleigh comes on screen.
            if (settings.Gifts) {
                const count = Math.floor(random(2, 5));
                const spots = Array.from({length: count}, () => random(0.12, 0.88) * window.innerWidth).sort((a, b) => a - b);
                spots.forEach((spot) => later(() => {
                    const gift = dropGift(next);
                    setGifts((list) => [...list, gift]);
                    later(() => setGifts((list) => list.map((g) => (g.id === gift.id ? {...g, leaving: true} : g))), gift.drop + GIFT_LIFETIME);
                    later(() => setGifts((list) => list.filter((g) => g.id !== gift.id)), gift.drop + GIFT_LIFETIME + 700);
                }, timeAt(next, spot)));
            }
            later(() => {
                setFlight(null);
                schedule();
            }, next.duration);
        }, random(settings.SantaMinSeconds, settings.SantaMaxSeconds) * 1000);
        schedule();
        return clear;
    }, [settings, later, clear, playSound]);

    useEffect(() => {
        if (!wish) return undefined;
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setWish(null);
        };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, [wish]);

    const open = (gift: Gift, target: HTMLElement) => {
        if (gift.opened) return;
        const box = target.getBoundingClientRect();
        setGifts((list) => list.map((g) => (g.id === gift.id ? {...g, opened: true} : g)));
        later(() => setGifts((list) => list.filter((g) => g.id !== gift.id)), 1100);
        const id = ++nextId;
        setWish({id, x: box.left + box.width / 2, y: box.top, reward: pick(rewards)});
        later(() => setWish((current) => (current?.id === id ? null : current)), WISH_LIFETIME);
    };

    return <>
        <div className='cm-effects' aria-hidden='true'>
            {settings.Snow && <Snow density={settings.SnowDensity}/>}
            {settings.Santa && <div className='cm-stars'>{Array.from({length: 7}, (_, i) => <i key={i} style={{left: `${8 + i * 14}%`, top: `${58 + (i % 3) * 23}px`, animationDelay: `${i * -3.3}s`}}/>)}</div>}
            {flight && <div key={flight.id} className='cm-flight' style={{top: flight.top, width: flight.width, '--cm-start': `${-flight.width}px`, '--cm-travel': `${flight.travel}px`, '--cm-duration': `${flight.duration}ms`} as Style}>
                <div className='cm-float'>
                    <div className='cm-trail'>{Array.from({length: 12}, (_, i) => <i key={i} style={{left: `${10 - i * 11}px`, top: `${80 + Math.sin(i) * 8}%`, animationDelay: `${-i * 0.22}s`, opacity: 1 - i / 13}}/>)}</div>
                    <Sleigh/>
                </div>
            </div>}
        </div>
        {settings.Snowman && <Snowman reserveRight={settings.Tree ? TREE_WIDTH + 16 : 0}/>}
        {settings.Tree && <ChristmasTree wishes={wishes} newWish={newWish} showWishes={settings.Wishes}/>}
        <div className='cm-gift-layer'>
            {gifts.map((gift) => {
                const className = `cm-gift${gift.opened ? ' cm-gift-open' : ''}${gift.leaving ? ' cm-gift-leaving' : ''}`;
                const style = {left: gift.x, top: gift.y, width: gift.size, '--cm-fall': `${gift.fall}px`, '--cm-drift': `${gift.drift}px`, '--cm-turn': `${gift.turn}deg`, '--cm-drop': `${gift.drop}ms`} as Style;
                const art = <span className='cm-gift-body'><Present color={gift.colors[0]} ribbon={gift.colors[1]}/><span className='cm-gift-burst'/></span>;
                return settings.GiftGreetings ?
                    <button key={gift.id} type='button' className={className} style={style} aria-label='Open a Christmas gift' title='Open me!' onClick={(event) => open(gift, event.currentTarget)}>{art}</button> :
                    <div key={gift.id} className={`${className} cm-gift-static`} style={style} aria-hidden='true'>{art}</div>;
            })}
            {wish && <div className='cm-wish' role='status' style={{left: Math.min(Math.max(12, wish.x - 140), window.innerWidth - 292), top: Math.max(12, wish.y - 170)}}>
                <span className='cm-wish-icon' aria-hidden='true'>🎁</span>
                <div>
                    <strong>{name ? `Congratulations, ${name}!` : 'Congratulations!'}</strong>
                    <p className='cm-wish-headline'>{wish.reward[0]}</p>
                    {wish.reward[1] && <p>{wish.reward[1]}</p>}
                </div>
                {settings.JustKidding && <span className='cm-wish-kidding'>just kidding 😄</span>}
                <button type='button' aria-label='Close Christmas wish' onClick={() => setWish(null)}>×</button>
            </div>}
        </div>
    </>;
}
