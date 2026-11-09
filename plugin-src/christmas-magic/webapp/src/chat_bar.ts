import type React from 'react';
import {useEffect, useState} from 'react';

export type Style = React.CSSProperties & Record<`--${string}`, string | number>;

// The message box at the bottom of the center channel. Not part of the plugin SDK, so
// callers must cope with it being absent (e.g. on system console pages).
export function findChatBar(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#post-create .AdvancedTextEditor') || document.querySelector<HTMLElement>('#post-create');
}

// Where falling presents come to rest: on top of the message box, else near the bottom edge.
export function chatFloor(): number {
    const box = findChatBar()?.getBoundingClientRect();
    return box && box.height > 0 ? box.top : window.innerHeight - 16;
}

export interface ChatBarRect {left: number; top: number; width: number}

// The message box's position, kept current as it moves, grows or is replaced. Null when absent or too narrow.
export function useChatBar(): ChatBarRect | null {
    const [rect, setRect] = useState<ChatBarRect | null>(null);
    useEffect(() => {
        let frame = 0;
        let observed: Element | null = null;
        const update = () => {
            frame = 0;
            const bar = findChatBar();
            if (bar !== observed) {
                if (observed) resizes.unobserve(observed);
                if (bar) resizes.observe(bar);
                observed = bar;
            }
            const box = bar?.getBoundingClientRect();
            const next = box && box.width > 220 && box.height > 0 ? {left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width)} : null;
            setRect((current) => (current && next && current.left === next.left && current.top === next.top && current.width === next.width ? current : next));
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        const resizes = new ResizeObserver(schedule);
        const mutations = new MutationObserver(schedule);
        mutations.observe(document.body, {childList: true, subtree: true});
        window.addEventListener('resize', schedule);
        update();
        return () => {
            cancelAnimationFrame(frame);
            mutations.disconnect();
            resizes.disconnect();
            window.removeEventListener('resize', schedule);
        };
    }, []);
    return rect;
}
