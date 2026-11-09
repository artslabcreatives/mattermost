import React, {useEffect, useState} from 'react';

import {Snowman as SnowmanArt} from './artwork';
import {useChatBar, type Style} from './chat_bar';

const WIDTH = 56;
const HEIGHT = 68;
const INSET = 12;
const SLIP_TIME = 2800; // Matches the cm-slip animation in style.css.

// Walks back and forth along the top edge of the message box, following it as it moves or resizes.
// `reserveRight` keeps it clear of the Christmas tree in the right-hand corner.
export default function Snowman({reserveRight = 0}: {reserveRight?: number}) {
    const lane = useChatBar();
    const [fallen, setFallen] = useState(false);
    useEffect(() => {
        if (!fallen) return undefined;
        const timer = window.setTimeout(() => setFallen(false), SLIP_TIME);
        return () => clearTimeout(timer);
    }, [fallen]);
    if (!lane) return null;
    const distance = lane.width - WIDTH - INSET * 2 - reserveRight;
    // Clicking the snowman makes it slip, fall on its back, see stars, and get back up.
    return <div className={`cm-snowman-lane${fallen ? ' cm-fallen' : ''}`} aria-hidden='true' style={{left: lane.left + INSET, top: lane.top - HEIGHT + 4, width: lane.width - INSET * 2 - reserveRight, '--cm-walk': `${distance}px`, '--cm-walk-time': `${Math.max(10, distance / 38)}s`} as Style}>
        <div className='cm-snowman-walk'><div className='cm-snowman-turn'>
            <button type='button' className='cm-snowman-hit' tabIndex={-1} title='Boop!' onClick={() => setFallen(true)}><SnowmanArt/></button>
            <span className='cm-snowman-puff'/>
            <span className='cm-snowman-dizzy'><span className='cm-dizzy-orbit'><i>✦</i><i>✦</i><i>✦</i></span></span>
        </div></div>
    </div>;
}
