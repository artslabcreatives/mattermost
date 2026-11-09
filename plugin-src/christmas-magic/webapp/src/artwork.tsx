import React from 'react';

// Bootstrap Icons "snow2" (16×16 viewBox), used for the falling snowflakes.
export const SNOWFLAKE_PATH = 'M8 16a.5.5 0 0 1-.5-.5v-1.293l-.646.647a.5.5 0 0 1-.707-.708L7.5 12.793v-1.086l-.646.647a.5.5 0 0 1-.707-.708L7.5 10.293V8.866l-1.236.713-.495 1.85a.5.5 0 1 1-.966-.26l.237-.882-.94.542-.496 1.85a.5.5 0 1 1-.966-.26l.237-.882-1.12.646a.5.5 0 0 1-.5-.866l1.12-.646-.884-.237a.5.5 0 1 1 .26-.966l1.848.495.94-.542-.882-.237a.5.5 0 1 1 .258-.966l1.85.495L7 8l-1.236-.713-1.849.495a.5.5 0 1 1-.258-.966l.883-.237-.94-.542-1.85.495a.5.5 0 0 1-.258-.966l.883-.237-1.12-.646a.5.5 0 1 1 .5-.866l1.12.646-.237-.883a.5.5 0 0 1 .966-.258l.495 1.849.94.542-.236-.883a.5.5 0 0 1 .966-.258l.495 1.849 1.236.713V5.707L6.147 4.354a.5.5 0 1 1 .707-.708l.646.647V3.207L6.147 1.854a.5.5 0 1 1 .707-.708l.646.647V.5a.5.5 0 0 1 1 0v1.293l.647-.647a.5.5 0 1 1 .707.708L8.5 3.207v1.086l.647-.647a.5.5 0 1 1 .707.708L8.5 5.707v1.427l1.236-.713.495-1.85a.5.5 0 1 1 .966.26l-.236.882.94-.542.495-1.85a.5.5 0 1 1 .966.26l-.236.882 1.12-.646a.5.5 0 0 1 .5.866l-1.12.646.883.237a.5.5 0 1 1-.26.966l-1.848-.495-.94.542.883.237a.5.5 0 1 1-.26.966l-1.848-.495L9 8l1.236.713 1.849-.495a.5.5 0 0 1 .259.966l-.883.237.94.542 1.849-.495a.5.5 0 0 1 .259.966l-.883.237 1.12.646a.5.5 0 0 1-.5.866l-1.12-.646.236.883a.5.5 0 1 1-.966.258l-.495-1.849-.94-.542.236.883a.5.5 0 0 1-.966.258L9.736 9.58 8.5 8.866v1.427l1.354 1.353a.5.5 0 0 1-.707.708l-.647-.647v1.086l1.354 1.353a.5.5 0 0 1-.707.708l-.647-.647V15.5a.5.5 0 0 1-.5.5';

// Sleigh artwork size and the point under the sleigh where presents are released.
export const SLEIGH_WIDTH = 440;
export const SLEIGH_HEIGHT = 170;
export const SLEIGH_DROP = {x: 74, y: 128};

export function SnowIcon() {
    return <svg width='16' height='16' viewBox='0 0 16 16' fill='currentColor' aria-hidden='true'>
        <path d={SNOWFLAKE_PATH}/>
    </svg>;
}

// A reindeer leg: thick upper leg from the hip, slim lower leg, dark hoof.
function Leg({className, color, d: [upper, lower, hoof]}: {className: string; color: string; d: [string, string, string]}) {
    return <g className={className} fill='none' strokeLinecap='round' strokeLinejoin='round'>
        <path d={upper} stroke={color} strokeWidth='8.5'/>
        <path d={lower} stroke={color} strokeWidth='3.6'/>
        <path d={hoof} stroke='#3b2a24' strokeWidth='5'/>
    </g>;
}

export function SoundIcon({on}: {on: boolean}) {
    return <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
        <path d='M2.5 6h2.5l3.5-3v10L5 10H2.5z' fill='currentColor'/>
        {on ? <path d='M11 5.5q1.5 2.5 0 5M12.8 3.8q3 4.2 0 8.4'/> : <path d='M11 6l4 4m0-4-4 4'/>}
    </svg>;
}

function Reindeer({x, y, delay, rudolph = false}: {x: number; y: number; delay: string; rudolph?: boolean}) {
    return <g transform={`translate(${x} ${y}) scale(.95)`}>
        <g className='cm-deer' style={{animationDelay: delay}}>
            {/* Far legs, behind the body: front reaching forward, back stretched behind. */}
            <Leg className='cm-leg-front' color='#7a4a2c' d={['M58 57L71 61', 'M71 61L84 56', 'M84 56l3.5-1.6']}/>
            <Leg className='cm-leg-back' color='#7a4a2c' d={['M24 57L12 63', 'M12 63L-2 62', 'M-2 62l-3.5.4']}/>
            <path d='M15 45C8 41 6 34 10 31c3 4 6 8 9 11z' fill='#f6ebdd'/>
            <path d='M14 50c-2-12 10-16 24-14 12 1 20-2 28 2 8 4 8 18 0 24-8 6-36 6-46 0-6-3-6-7-6-12z' fill='url(#cm-fur)'/>
            <path d='M22 58c10 8 34 8 44 0-6 10-36 12-44 0z' fill='#dcae7a'/>
            <path d='M58 40c2-10 8-18 16-23l12 7c-8 6-12 16-14 28z' fill='url(#cm-fur)'/>
            <path d='M64 38q6 2 7 7 4 3 1 8 2 5-3 7-1-6-5-9-3-6 0-13z' fill='#f6ebdd'/>
            <path d='M78 11C74 2 70-4 64-8M73 2c-5 0-9-2-11-5M70-2c0-5 2-8 4-11M86 10c2-9 6-15 12-19M90 2c5 0 9-2 11-5M92-3c0-5-2-8-4-11' stroke='#8a6240' strokeWidth='3.2' strokeLinecap='round' fill='none'/>
            <path d='M76 14c-8-6-14-4-12 0 2 3 8 3 12 2z' fill='#93582f'/>
            <path d='M74 14.5c-5-3.5-8-2.5-7-.5 1 1.5 4 2 7 1.5z' fill='#f2b8a2'/>
            <path d='M72 18c2-8 12-10 18-6 6 3 10 8 14 11 3 3 0 8-6 8s-12-1-18-3c-6-2-10-5-8-10z' fill='#b9784a'/>
            <path d='M92 22c6-1 13 1 13 5-1 4-8 5-14 3z' fill='#e0b585'/>
            <path d='M96 30q3 2 6 0' stroke='#5a3a2c' strokeWidth='1.2' strokeLinecap='round' fill='none'/>
            {rudolph && <circle className='cm-nose-glow' cx='105' cy='25.5' r='10' fill='url(#cm-nose-glow)'/>}
            <circle cx='105' cy='25.5' r={rudolph ? 4.3 : 3.4} fill={rudolph ? '#ee2b3b' : '#3b2a24'}/>
            <circle cx='84' cy='17' r='2.2' fill='#2b2020'/><circle cx='84.8' cy='16.2' r='.8' fill='#fff'/>
            <path d='M81.6 14.6l-1.6-1.6' stroke='#2b2020' strokeWidth='1' strokeLinecap='round'/>
            <path d='M38 36c-2 10-2 20 0 30' stroke='#c62f3b' strokeWidth='5' fill='none'/>
            <g fill='#f2c94c'><circle cx='37.4' cy='44' r='1.5'/><circle cx='37' cy='52' r='1.5'/><circle cx='37.4' cy='60' r='1.5'/></g>
            <path d='M66 34c4 8 12 8 16-2' stroke='#c62f3b' strokeWidth='5' fill='none' strokeLinecap='round'/>
            <g fill='#f2c94c' stroke='#c9962a' strokeWidth='.6'><circle cx='69' cy='41' r='3'/><circle cx='74' cy='43' r='3'/><circle cx='79' cy='40' r='3'/></g>
            <g fill='#7a5a1a'><circle cx='69' cy='42' r='.7'/><circle cx='74' cy='44' r='.7'/><circle cx='79' cy='41' r='.7'/></g>
            {/* Near legs, in front of the body: front tucked under, back stretched behind. */}
            <Leg className='cm-leg-front' color='#8a5232' d={['M62 57L74 67', 'M74 67L66 77', 'M66 77l-2.6 2.2']}/>
            <Leg className='cm-leg-back' color='#8a5232' d={['M30 59L18 69', 'M18 69L4 73', 'M4 73l-3.6.9']}/>
        </g>
    </g>;
}

export function Sleigh() {
    return <svg className='cm-sleigh-art' width={SLEIGH_WIDTH} height={SLEIGH_HEIGHT} viewBox={`0 0 ${SLEIGH_WIDTH} ${SLEIGH_HEIGHT}`} aria-hidden='true'>
        <defs>
            <linearGradient id='cm-fur' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stopColor='#c3824f'/><stop offset='1' stopColor='#94592f'/></linearGradient>
            <linearGradient id='cm-sleigh-red' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stopColor='#e8414f'/><stop offset='1' stopColor='#9b1530'/></linearGradient>
            <linearGradient id='cm-gold' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stopColor='#d99a2b'/><stop offset='.5' stopColor='#ffe08a'/><stop offset='1' stopColor='#d99a2b'/></linearGradient>
            <radialGradient id='cm-nose-glow'><stop offset='0' stopColor='#ff4d5a' stopOpacity='.9'/><stop offset='1' stopColor='#ff4d5a' stopOpacity='0'/></radialGradient>
        </defs>
        <path d='M160 72Q214 104 266 96M160 72Q272 94 376 79' fill='none' stroke='#e9c46a' strokeWidth='1.8'/>
        <Reindeer x={196} y={57} delay='-.35s'/>
        <Reindeer x={306} y={40} delay='0s' rudolph={true}/>

        {/* Sack of presents behind Santa */}
        <g transform='rotate(-12 40 54)'><rect x='28' y='42' width='22' height='20' rx='2' fill='#2a9d6f'/><path d='M39 42v20M28 51h22' stroke='#fff1c1' strokeWidth='3.5'/></g>
        <g transform='rotate(10 60 50)'><rect x='50' y='40' width='18' height='22' rx='2' fill='#3a6fd8'/><path d='M59 40v22M50 49h18' stroke='#ffe08a' strokeWidth='3'/></g>
        <path d='M16 112Q8 74 32 62q16-6 32 2 18 10 10 48z' fill='#8b5a3c'/>
        <path d='M26 66q16 6 34 0' stroke='#6b3f27' strokeWidth='3' fill='none' strokeLinecap='round'/>
        <path d='M26 80q6 16 2 28' stroke='#6b3f27' strokeWidth='2' fill='none' opacity='.6'/>

        {/* Santa */}
        <path d='M78 114Q72 72 100 62q26-5 34 22l6 30z' fill='#d42b3a'/>
        <path d='M104 63v51' stroke='#fffaf3' strokeWidth='7'/>
        <rect x='76' y='93' width='64' height='9' fill='#2b1d1f'/>
        <rect x='99' y='90.5' width='13' height='14' rx='2' fill='none' stroke='#f2c94c' strokeWidth='2.5'/>
        <path d='M122 78q18 6 31-3' stroke='#d42b3a' strokeWidth='12' strokeLinecap='round' fill='none'/>
        <circle cx='153' cy='74' r='7' fill='#fffaf3'/><circle cx='160' cy='72' r='6' fill='#2e7d4f'/>
        <g className='cm-wave'>
            <path d='M88 76Q74 62 77 42' stroke='#d42b3a' strokeWidth='12' strokeLinecap='round' fill='none'/>
            <circle cx='77' cy='42' r='7' fill='#fffaf3'/><circle cx='77' cy='33' r='6.5' fill='#2e7d4f'/>
            <path d='M71 31l-4-4' stroke='#2e7d4f' strokeWidth='4' strokeLinecap='round'/>
        </g>
        <circle cx='106' cy='44' r='15' fill='#f6c9a8'/>
        <circle cx='97' cy='48' r='4' fill='#f19c95' opacity='.7'/><circle cx='115' cy='48' r='4' fill='#f19c95' opacity='.7'/>
        <path d='M88 45Q89 74 106 81 123 74 124 45 118 56 106 56 94 56 88 45z' fill='#fffaf3'/>
        <path d='M96 53q5-6 10-2 5-4 10 2-5 5-10 2-5 3-10-2z' fill='#fff' stroke='#e2ddd5' strokeWidth='.8'/>
        <circle cx='106' cy='48' r='3.6' fill='#ee9a86'/>
        <path d='M98 41q3-3 6 0M108 41q3-3 6 0' stroke='#3a2a2a' strokeWidth='2' strokeLinecap='round' fill='none'/>
        <path d='M97 36q4-3 8 0M107 36q4-3 8 0' stroke='#fff' strokeWidth='3' strokeLinecap='round' fill='none'/>
        <path d='M90 33q2-21 19-22 13 0 17 14l1 8z' fill='#d42b3a'/>
        <path d='M97 18Q82 8 68 22l5 5q12-10 26 0z' fill='#c22233'/>
        <circle cx='68' cy='25' r='6' fill='#fffaf3'/>
        <rect x='87' y='29' width='43' height='9' rx='4.5' fill='#fffaf3'/>

        {/* Sleigh */}
        <path d='M20 160H166q24 0 26-20 0-10-10-10' stroke='url(#cm-gold)' strokeWidth='5' strokeLinecap='round' fill='none'/>
        <path d='M50 138v22M132 138v22' stroke='url(#cm-gold)' strokeWidth='4' strokeLinecap='round'/>
        <path d='M10 62q16-6 18 12l4 38h118q12 0 18-12 6-12 18-12 10 2 6 12-6 8-14 6-8 30-46 32H38q-24-2-28-28z' fill='url(#cm-sleigh-red)'/>
        <path d='M10 62q16-6 18 12l4 38h118q12 0 18-12 6-12 18-12 10 2 6 12' stroke='#f2c94c' strokeWidth='3.5' fill='none' strokeLinecap='round' strokeLinejoin='round'/>
        <path d='M8 63q9-8 21 3' stroke='#fff' strokeWidth='4' strokeLinecap='round' fill='none'/>
        <circle cx='190' cy='95' r='3' fill='#f2c94c'/>
        <path d='M46 132q12-8 24 0t24 0t24 0t24 0' stroke='#f6d27a' strokeWidth='2.5' fill='none' strokeLinecap='round'/>
        <path transform='translate(94 121) scale(.8)' d='M0-9l2.6 5.4 6 .8-4.3 4.2 1 5.9L0 4.5-5.3 7.3l1-5.9L-8.6-2.8l6-.8z' fill='#ffe08a'/>
    </svg>;
}

export function Present({color = '#d7263d', ribbon = '#ffd166'}: {color?: string; ribbon?: string}) {
    return <svg viewBox='0 0 48 52' width='48' height='52' aria-hidden='true'>
        <rect x='6' y='22' width='36' height='28' rx='3' fill={color}/>
        <path d='M30 22h9a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3h-9z' fill='#000' opacity='.14'/>
        <rect x='21' y='22' width='6' height='28' fill={ribbon}/>
        <g className='cm-lid'>
            <rect x='3' y='14' width='42' height='10' rx='2.5' fill={color}/>
            <rect x='3' y='14' width='42' height='4' rx='2' fill='#fff' opacity='.2'/>
            <rect x='21' y='14' width='6' height='10' fill={ribbon}/>
            <path d='M24 14C15 1 5 7 11 13c4 3 10 2 13 1zM24 14c9-13 19-7 13-1-4 3-10 2-13 1z' fill={ribbon}/>
            <circle cx='24' cy='14' r='3.2' fill={ribbon} stroke='#000' strokeOpacity='.15'/>
        </g>
    </svg>;
}

export function Snowman() {
    return <svg className='cm-snowman' viewBox='0 0 100 120' width='56' height='68' aria-hidden='true'>
        <g className='cm-arm-l' stroke='#7b4a2b' strokeWidth='2.6' strokeLinecap='round' fill='none'><path d='M36 60L12 46M19 50l-3-9M16 48H8'/></g>
        <g className='cm-arm-r' stroke='#7b4a2b' strokeWidth='2.6' strokeLinecap='round' fill='none'><path d='M64 60l24-14M81 50l3-9M84 48h8'/></g>
        <circle cx='50' cy='94' r='25' fill='#cfcbe8'/><circle cx='55' cy='92' r='20.5' fill='#fbf5f3'/>
        <circle cx='50' cy='60' r='17' fill='#cfcbe8'/><circle cx='54' cy='59' r='13.5' fill='#fbf5f3'/>
        <circle cx='50' cy='32' r='15' fill='#cfcbe8'/><circle cx='53' cy='31' r='12' fill='#fbf5f3'/>
        <path d='M35 45q15 7 30 0l1 7q-16 8-32 0z' fill='#d62839'/>
        <g className='cm-scarf'>
            <path d='M57 50l5 20-8 1-3-19z' fill='#c41f30'/>
            <path d='M55 71v3M58 70.5v3M61 70v3' stroke='#c41f30' strokeWidth='1.5' strokeLinecap='round'/>
        </g>
        <circle cx='45' cy='30' r='2' fill='#3b2b2b'/><circle cx='56' cy='30' r='2' fill='#3b2b2b'/>
        <circle cx='41' cy='36' r='2.5' fill='#f6b8c0' opacity='.6'/><circle cx='60' cy='36' r='2.5' fill='#f6b8c0' opacity='.6'/>
        <path d='M50 34l15 3.2-15 2.6z' fill='#f28c28'/>
        <g fill='#3b2b2b'>
            <circle cx='44.5' cy='40' r='1.15'/><circle cx='47.5' cy='41.3' r='1.15'/><circle cx='51' cy='41.8' r='1.15'/>
            <circle cx='54.5' cy='41.3' r='1.15'/><circle cx='57.5' cy='40' r='1.15'/>
        </g>
        <path d='M36 22q2-17 18-17 13 1 17 11l4 8z' fill='#d62839'/>
        <path d='M64 9q12 0 15 12l-4 1q-3-7-9-7z' fill='#c41f30'/>
        <circle cx='77' cy='23' r='4.5' fill='#fff' stroke='#e2e0ee'/>
        <rect x='33' y='19' width='40' height='8' rx='4' fill='#fff'/><rect x='33' y='23' width='40' height='4' rx='2' fill='#e6e3f3'/>
    </svg>;
}
