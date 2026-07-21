import {useState} from 'react';

import {avatarUrl, displayName} from '../mattermost';
import {Booking, UserProfile} from '../types';
import {formatDuration, formatRange} from '../utils/time';

interface Props {
    booking: Booking;
    users: Map<string, UserProfile>;
    canModify: boolean;
    isMine: boolean;
    onEdit: (booking: Booking) => void;
    onDelete: (booking: Booking) => Promise<void>;
}

function getGoogleCalendarUrl(booking: Booking, hostName?: string): string {
    const dateParts = booking.date.split('-');
    if (dateParts.length !== 3) {
        return 'https://calendar.google.com';
    }

    const year = dateParts[0];
    const month = dateParts[1];
    const day = dateParts[2];

    const startH = String(Math.floor(booking.start_minute / 60)).padStart(2, '0');
    const startM = String(booking.start_minute % 60).padStart(2, '0');
    const endH = String(Math.floor(booking.end_minute / 60)).padStart(2, '0');
    const endM = String(booking.end_minute % 60).padStart(2, '0');

    const dates = `${year}${month}${day}T${startH}${startM}00/${year}${month}${day}T${endH}${endM}00`;

    const details = hostName ? `Host: ${hostName}${booking.notes ? '\n\n' + booking.notes : ''}` : booking.notes || '';

    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: booking.title,
        dates,
        details,
        location: 'Board Room',
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function BookingCard({booking, users, canModify, isMine, onEdit, onDelete}: Props) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const host = users.get(booking.host_id);
    const participants = booking.participant_ids.map((id) => users.get(id)).filter(Boolean) as UserProfile[];
    const gcalUrl = getGoogleCalendarUrl(booking, displayName(host));

    const confirmDelete = async () => {
        setBusy(true);
        try {
            await onDelete(booking);
        } finally {
            // The card unmounts on success; this only matters if it failed.
            setBusy(false);
            setConfirming(false);
        }
    };

    return (
        <article className={`brk-card ${isMine ? 'brk-card--mine' : 'brk-card--other'}`}>
            <div className='brk-card__time'>
                <span className='brk-card__range'>{formatRange(booking.start_minute, booking.end_minute)}</span>
                <span className='brk-card__duration'>{formatDuration(booking.end_minute - booking.start_minute)}</span>
            </div>

            <div className={`brk-card__details${isMine ? '' : ' brk-card__details--blurred'}`}>
                <h4 className='brk-card__title'>{isMine ? booking.title : 'Reserved Meeting'}</h4>

                <div className='brk-card__people'>
                    <img
                        className='brk-card__avatar'
                        src={avatarUrl(booking.host_id)}
                        alt=''
                    />
                    <span className='brk-card__host'>{displayName(host)}</span>
                    <span className='brk-card__host-tag'>{'Host'}</span>
                </div>

                {participants.length > 0 && (
                    <div className='brk-card__participants'>
                        <div className='brk-card__avatars'>
                            {participants.slice(0, 5).map((user) => (
                                <img
                                    key={user.id}
                                    className='brk-card__avatar'
                                    src={avatarUrl(user.id)}
                                    alt={displayName(user)}
                                    title={displayName(user)}
                                />
                            ))}
                            {participants.length > 5 && (
                                <span className='brk-card__more'>{`+${participants.length - 5}`}</span>
                            )}
                        </div>
                        <span className='brk-card__count'>
                            {participants.length === 1 ? '1 participant' : `${participants.length} participants`}
                        </span>
                    </div>
                )}

                {booking.notes && <p className='brk-card__notes'>{booking.notes}</p>}

                {isMine && booking.sync_state === 'synced' && (
                    <div className='brk-card__sync'>
                        <a
                            href={gcalUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{color: 'inherit', textDecoration: 'underline'}}
                        >
                            {'✓ On Google Calendar'}
                        </a>
                    </div>
                )}
                {isMine && booking.sync_state === 'failed' && (
                    <div
                        className='brk-card__sync brk-card__sync--failed'
                        title={booking.sync_error}
                    >
                        {'⚠ Not added automatically to Google Calendar — '}
                        <a
                            href={gcalUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{color: 'inherit', textDecoration: 'underline'}}
                        >
                            {'Add manually'}
                        </a>
                    </div>
                )}
                {isMine && !booking.sync_state && (
                    <div className='brk-card__sync'>
                        <a
                            href={gcalUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{color: '#1665d8', textDecoration: 'none'}}
                        >
                            {'📅 Add to Google Calendar'}
                        </a>
                    </div>
                )}
            </div>

            {canModify && !confirming && (
                <div className='brk-card__actions'>
                    <button
                        type='button'
                        className='brk-btn brk-btn--link'
                        onClick={() => onEdit(booking)}
                    >
                        {'Edit'}
                    </button>
                    <button
                        type='button'
                        className='brk-btn brk-btn--link brk-btn--danger'
                        onClick={() => setConfirming(true)}
                    >
                        {'Cancel booking'}
                    </button>
                </div>
            )}

            {confirming && (
                <div className='brk-card__confirm'>
                    <span>{'Cancel this booking?'}</span>
                    <div className='brk-card__actions'>
                        <button
                            type='button'
                            className='brk-btn brk-btn--tertiary'
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                        >
                            {'Keep it'}
                        </button>
                        <button
                            type='button'
                            className='brk-btn brk-btn--danger-solid'
                            onClick={confirmDelete}
                            disabled={busy}
                        >
                            {busy ? 'Cancelling…' : 'Yes, cancel'}
                        </button>
                    </div>
                </div>
            )}
        </article>
    );
}
