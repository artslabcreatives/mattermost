import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';

import {SnowIcon, SoundIcon} from './artwork';
import type {Controller} from './controller';
import Effects from './effects';
import styles from './style.css';

export function useSnapshot(controller: Controller) {
    const [snapshot, setSnapshot] = useState(controller.snapshot);
    useEffect(() => {
        const update = () => setSnapshot(controller.snapshot);
        const unsubscribe = controller.subscribe(update);
        update();
        return unsubscribe;
    }, [controller]);
    return snapshot;
}

export function Switch({controller}: {controller: Controller}) {
    const {checked, reason} = useSnapshot(controller);
    return <button type='button' className='cm-switch' role='switch' aria-checked={checked} aria-label='Christmas animations' disabled={Boolean(reason)} onClick={controller.toggle} title={reason || `Turn Christmas animations ${checked ? 'off' : 'on'}`}>
        <SnowIcon/><span className='cm-label'>Animations</span>
        <span className='cm-switch-track' aria-hidden='true'><span/></span>
        <span className='cm-switch-state' aria-hidden='true'>{checked ? 'On' : 'Off'}</span>
    </button>;
}

// Shown only when the administrator has Santa's sound enabled.
export function SoundSwitch({controller}: {controller: Controller}) {
    const {checked, soundPreferred, settings} = useSnapshot(controller);
    if (!settings.Santa || !settings.Sound) return null;
    const on = checked && soundPreferred;
    return <button type='button' className='cm-sound' role='switch' aria-checked={on} aria-label='Christmas sound' disabled={!checked} onClick={controller.toggleSound} title={checked ? `Turn Santa's sound ${on ? 'off' : 'on'}` : 'Turn on Christmas animations to hear Santa'}>
        <SoundIcon on={on}/>
    </button>;
}

export function MenuLabel({controller}: {controller: Controller}) {
    const {checked, reason} = useSnapshot(controller);
    return <span title={reason || undefined}>{reason || `Turn Christmas animations ${checked ? 'off' : 'on'}`}</span>;
}

// The public SDK has no global-header slot. This isolated adapter only adds/removes
// our own host. If the header changes, the supported channel-header slot is used.
function useHeaderHost() {
    const [host, setHost] = useState<HTMLElement | null>(null);
    useEffect(() => {
        const element = document.createElement('div');
        element.className = 'cm-header-host';
        element.dataset.christmasMagic = 'header';
        const attach = () => {
            const parent = document.querySelector('#global-header #RightControlsContainer');
            if (parent && element.parentElement !== parent) {parent.prepend(element); setHost(element);}
            else if (!parent && element.parentElement) {element.remove(); setHost(null);}
        };
        attach();
        const observer = new MutationObserver(attach);
        observer.observe(document.body, {childList: true, subtree: true});
        return () => {observer.disconnect(); element.remove();};
    }, []);
    return host;
}

export default function App({controller}: {controller: Controller}) {
    const {active, userId, settings, name, sound, soundUrl, wishes, newWish} = useSnapshot(controller);
    const host = useHeaderHost();
    if (!userId) return null;
    return <>
        <style>{styles}</style>
        {host && createPortal(<><Switch controller={controller}/><SoundSwitch controller={controller}/></>, host)}
        {active && createPortal(<Effects settings={settings} name={name} sound={sound} soundUrl={soundUrl} wishes={wishes} newWish={newWish}/>, document.body)}
    </>;
}

export function FallbackSwitch({controller}: {controller: Controller}) {
    const {userId} = useSnapshot(controller);
    const [show, setShow] = useState(false);
    useEffect(() => {
        const update = () => {
            const header = document.querySelector('#global-header #RightControlsContainer');
            setShow(!header || window.innerWidth <= 768);
        };
        update();
        window.addEventListener('resize', update);
        const observer = new MutationObserver(update);
        observer.observe(document.body, {childList: true, subtree: true});
        return () => {window.removeEventListener('resize', update); observer.disconnect();};
    }, []);
    return show && userId ? <div className='cm-channel-switch'><Switch controller={controller}/><SoundSwitch controller={controller}/></div> : null;
}
