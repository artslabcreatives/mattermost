import React, {useEffect, useRef, useState} from 'react';

import {useChatBar, type Style} from './chat_bar';
import type {Wish} from './settings';

export const TREE_WIDTH = 84;
const TREE_HEIGHT = 110;
const SPIN = 9; // Seconds per turn; matches cm-tree-spin and cm-tree-shade in style.css.
const ORNAMENTS = ['#e63946', '#ffd166', '#4cc9f0', '#f72585', '#ffffff'];
const SAVED_GAP = 12000; // Pause between saved wishes taking turns.

// One flat silhouette of the tree. Four of these cross at the centre and spin together,
// each shaded by its angle, so the tree looks solid from every side.
function TreePlane({angle, index}: {angle: number; index: number}) {
    const ornaments = [[24, 34], [41, 46], [20, 58], [36, 66], [47, 72], [28, 47]].map(([x, y], i) => [x + ((index * 3 + i) % 3) - 1, y, i] as const);
    return <svg className='cm-tree-plane' viewBox='0 0 64 84' style={{transform: `rotateY(${angle}deg)`, animationDelay: `${-angle / 360 * SPIN}s`}} aria-hidden='true'>
        <rect x='28' y='72' width='8' height='8' rx='1' fill='#7b4a2b'/>
        <path d='M32 46 8 76h48z' fill='#1f7a3d'/>
        <path d='M32 30 12 60h40z' fill='#26914a'/>
        <path d='M32 14 17 44h30z' fill='#2fa857'/>
        <path d='M14 70q18-6 36-2M18 54q14-5 28-1M21 39q11-4 22-1' stroke='#ffd166' strokeWidth='1.4' fill='none' strokeLinecap='round'/>
        {ornaments.map(([x, y, i]) => <circle key={i} className='cm-ornament' cx={x} cy={y} r='2.6' fill={ORNAMENTS[(i + index) % ORNAMENTS.length]} style={{animationDelay: `${-(i * 0.7 + index * 0.3)}s`}}/>)}
    </svg>;
}

function Tree() {
    return <div className='cm-tree-stage'>
        <div className='cm-tree-shadow'/>
        <div className='cm-tree-3d'>{[0, 45, 90, 135].map((angle, i) => <TreePlane key={angle} angle={angle} index={i}/>)}</div>
        <svg className='cm-tree-star' viewBox='-10 -10 20 20' aria-hidden='true'>
            <path d='M0-9l2.6 5.4 6 .8-4.3 4.2 1 5.9L0 4.5-5.3 7.3l1-5.9L-8.6-2.8l6-.8z' fill='#ffd166' stroke='#f4a300' strokeWidth='.6'/>
        </svg>
    </div>;
}

interface Showing {wish: Wish; live: boolean}

// How long a bubble stays up: longer wishes get more reading time.
const lifetime = (wish: Wish) => Math.min(11000, 5000 + wish.message.length * 45);

// Shows wishes one at a time: new wishes first, then saved wishes take turns, newest first.
function useWishQueue(wishes: Wish[], newWish: Wish | null, enabled: boolean) {
    const [showing, setShowing] = useState<Showing | null>(null);
    const live = useRef<Wish[]>([]);
    const seen = useRef(new Set<string>());
    const turn = useRef(0);
    const first = useRef(true);
    const wishesRef = useRef(wishes);
    wishesRef.current = wishes;

    useEffect(() => {
        if (!enabled || !newWish || seen.current.has(newWish.id)) return;
        seen.current.add(newWish.id);
        if (showing && showing.live) live.current.push(newWish);
        else setShowing({wish: newWish, live: true}); // Interrupts a saved wish.
    }, [newWish, enabled]);

    useEffect(() => {
        const ids = new Set(wishes.map(({id}) => id));
        live.current = live.current.filter(({id}) => ids.has(id));
        if (showing && !ids.has(showing.wish.id)) setShowing(null);
    }, [wishes]);

    useEffect(() => {
        if (!enabled) {
            setShowing(null);
            return undefined;
        }
        if (showing) {
            const timer = window.setTimeout(() => setShowing(null), lifetime(showing.wish));
            return () => clearTimeout(timer);
        }
        const next = () => {
            const queued = live.current.shift();
            if (queued) return setShowing({wish: queued, live: true});
            const saved = [...wishesRef.current].reverse();
            if (saved.length) setShowing({wish: saved[turn.current++ % saved.length], live: false});
        };
        const delay = live.current.length ? 800 : first.current ? 4000 : SAVED_GAP;
        first.current = false;
        const timer = window.setTimeout(next, delay);
        return () => clearTimeout(timer);
    }, [showing, enabled, wishes.length]);

    return showing;
}

// A rotating 3D Christmas tree on the top-right corner of the message box, with a speech bubble
// for Christmas wishes sent with /christmas.
export default function ChristmasTree({wishes, newWish, showWishes}: {wishes: Wish[]; newWish: Wish | null; showWishes: boolean}) {
    const bar = useChatBar();
    const showing = useWishQueue(wishes, newWish, showWishes);
    if (!bar) return null;
    return <div className='cm-tree-lane' style={{left: bar.left + bar.width - TREE_WIDTH - 10, top: bar.top - TREE_HEIGHT + 6}}>
        <div aria-hidden='true'><Tree/></div>
        {showing && <div key={showing.wish.id} className='cm-wish-bubble' role='status' style={{'--cm-life': `${lifetime(showing.wish)}ms`} as Style}>
            <span className='cm-wish-bubble-name'>🎄 {showing.wish.name} wishes</span>
            <span className='cm-wish-bubble-text'>{showing.wish.message}</span>
        </div>}
    </div>;
}
