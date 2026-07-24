import React from 'react';

export default function RHS() {
    return (
        <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
            <iframe
                src='https://drivehub.artslabcreatives.com'
                title='DriveHub'
                style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    flex: 1,
                }}
                allow='camera; microphone; clipboard-read; clipboard-write; display-capture'
            />
        </div>
    );
}
