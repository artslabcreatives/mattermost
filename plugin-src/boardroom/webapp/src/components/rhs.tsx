import {useCallback, useEffect, useMemo, useState} from 'react';
import {useSelector} from 'react-redux';

import * as client from '../client';
import {currentTeamId, currentUserId, fetchProfilesByIds, fetchTeamMembers} from '../mattermost';
import {Booking, BookingDraft, RoomConfig, UserProfile} from '../types';
import {addDays, formatDateHeading, formatDateShort, isPastBooking, isPastDate, todayString} from '../utils/time';

import BookingCard from './booking_card';
import BookingForm from './booking_form';

import '../styles.scss';

type Mode = {kind: 'list'} | {kind: 'create'} | {kind: 'edit'; booking: Booking};

export default function RHS() {
    const userId = useSelector(currentUserId);
    const teamId = useSelector(currentTeamId);

    const [config, setConfig] = useState<RoomConfig | null>(null);
    const [date, setDate] = useState(todayString());
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [extraUsers, setExtraUsers] = useState<UserProfile[]>([]);
    const [mode, setMode] = useState<Mode>({kind: 'list'});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const userMap = useMemo(
        () => new Map([...users, ...extraUsers].map((u) => [u.id, u])),
        [users, extraUsers],
    );

    const loadBookings = useCallback(async (forDate: string) => {
        if (!teamId) {
            return;
        }
        setLoading(true);
        setError('');
        try {
            setBookings(await client.fetchBookings(teamId, forDate, forDate));
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, [teamId]);

    // The room's hours and the team roster only change rarely, so they're
    // loaded once per team rather than on every date change.
    useEffect(() => {
        if (!teamId) {
            return;
        }
        let cancelled = false;

        (async () => {
            try {
                const [roomConfig, members] = await Promise.all([client.fetchConfig(), fetchTeamMembers(teamId)]);
                if (!cancelled) {
                    setConfig(roomConfig);
                    setUsers(members);
                }
            } catch (err) {
                if (!cancelled) {
                    setError((err as Error).message);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    useEffect(() => {
        loadBookings(date);
    }, [date, loadBookings]);

    // The roster is only the first page of the team and excludes people who
    // have since left, so pull in any attendee we can't already name. These
    // profiles are display-only and stay out of the pickers.
    useEffect(() => {
        const missing = new Set<string>();
        for (const booking of bookings) {
            for (const id of [booking.host_id, ...booking.participant_ids]) {
                if (!userMap.has(id)) {
                    missing.add(id);
                }
            }
        }
        if (missing.size === 0) {
            return;
        }

        let cancelled = false;
        fetchProfilesByIds([...missing]).then((profiles) => {
            if (!cancelled && profiles.length) {
                setExtraUsers((prev) => [...prev, ...profiles]);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [bookings, userMap]);

    // Switching teams would otherwise leave a half-built form, and stale
    // profiles, belonging to the old one.
    useEffect(() => {
        setMode({kind: 'list'});
        setExtraUsers([]);
    }, [teamId]);

    const onSaved = async () => {
        setMode({kind: 'list'});
        await loadBookings(date);
    };

    const onDelete = async (booking: Booking) => {
        try {
            await client.deleteBooking(booking.id);
            await loadBookings(date);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const save = (draft: BookingDraft) => {
        // Saving onto another day should leave the user looking at that day.
        const target = draft.date;
        const promise = mode.kind === 'edit' ?
            client.updateBooking(mode.booking.id, draft) :
            client.createBooking(draft);

        return promise.then((saved) => {
            if (target !== date) {
                setDate(target);
            }
            return saved;
        });
    };

    if (!teamId) {
        return <div className='brk-empty'>{'Open a team to book the board room.'}</div>;
    }

    if (!config) {
        return (
            <div className='brk-rhs'>
                {error ? <div className='brk-alert brk-alert--error'>{error}</div> : <div className='brk-empty'>{'Loading…'}</div>}
            </div>
        );
    }

    if (mode.kind !== 'list') {
        return (
            <div className='brk-rhs'>
                <header className='brk-rhs__header'>
                    <button
                        type='button'
                        className='brk-btn brk-btn--link'
                        onClick={() => setMode({kind: 'list'})}
                    >
                        {'← Back'}
                    </button>
                    <h3 className='brk-rhs__title'>
                        {mode.kind === 'edit' ? 'Edit booking' : `Book the ${config.room_name}`}
                    </h3>
                </header>
                <div className='brk-rhs__body'>
                    <BookingForm
                        config={config}
                        teamId={teamId}
                        currentUserId={userId}
                        users={users}
                        bookings={bookings}
                        date={date}
                        editing={mode.kind === 'edit' ? mode.booking : undefined}
                        onCancel={() => setMode({kind: 'list'})}
                        onSaved={onSaved}
                        save={save}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className='brk-rhs'>
            <header className='brk-rhs__header'>
                <div className='brk-datenav'>
                    <button
                        type='button'
                        className='brk-datenav__arrow'
                        aria-label='Previous day'
                        onClick={() => setDate(addDays(date, -1))}
                    >
                        {'‹'}
                    </button>
                    <div className='brk-datenav__current'>
                        <span className='brk-datenav__label'>{formatDateShort(date)}</span>
                        <input
                            className='brk-datenav__picker'
                            type='date'
                            value={date}
                            aria-label='Pick a date'
                            onChange={(e) => e.target.value && setDate(e.target.value)}
                        />
                    </div>
                    <button
                        type='button'
                        className='brk-datenav__arrow'
                        aria-label='Next day'
                        onClick={() => setDate(addDays(date, 1))}
                    >
                        {'›'}
                    </button>
                </div>
                {date !== todayString() && (
                    <button
                        type='button'
                        className='brk-btn brk-btn--link'
                        onClick={() => setDate(todayString())}
                    >
                        {'Today'}
                    </button>
                )}
            </header>

            <div className='brk-rhs__body'>
                <h3 className='brk-rhs__day'>{formatDateHeading(date)}</h3>

                {error && <div className='brk-alert brk-alert--error'>{error}</div>}

                {loading && <div className='brk-empty'>{'Loading…'}</div>}

                {!loading && bookings.length === 0 && (
                    <div className='brk-empty'>
                        <div className='brk-empty__icon'>{'🗓'}</div>
                        <p>{`The ${config.room_name} is free all day.`}</p>
                    </div>
                )}

                {!loading && bookings.map((booking) => {
                    const isMine = booking.created_by === userId || booking.host_id === userId || booking.participant_ids.includes(userId);
                    return (
                        <BookingCard
                            key={booking.id}
                            booking={booking}
                            users={userMap}
                            canModify={booking.created_by === userId && !isPastBooking(booking)}
                            isMine={isMine}
                            onEdit={(b) => setMode({kind: 'edit', booking: b})}
                            onDelete={onDelete}
                        />
                    );
                })}
            </div>

            <footer className='brk-rhs__footer'>
                <button
                    type='button'
                    className='brk-btn brk-btn--primary brk-btn--block'
                    disabled={isPastDate(date)}
                    onClick={() => setMode({kind: 'create'})}
                >
                    {isPastDate(date) ? 'That date has passed' : `Book the ${config.room_name}`}
                </button>
            </footer>
        </div>
    );
}
