import {useMemo, useState} from 'react';

import {ApiError, Booking, BookingDraft, RoomConfig, UserProfile} from '../types';
import {
    endOptions,
    findConflict,
    formatDuration,
    formatMinute,
    isPastDate,
    slotOptions,
    takenStarts,
    todayString,
} from '../utils/time';

import UserSelect from './user_select';

interface Props {
    config: RoomConfig;
    teamId: string;
    currentUserId: string;
    users: UserProfile[];
    bookings: Booking[];
    date: string;
    editing?: Booking;
    onCancel: () => void;
    onSaved: (booking: Booking) => void;
    save: (draft: BookingDraft) => Promise<Booking>;
}

export default function BookingForm(props: Props) {
    const {config, teamId, currentUserId, users, bookings, editing, onCancel, onSaved, save} = props;

    const defaults = useMemo(() => {
        if (editing) {
            return editing;
        }
        // Default to the first slot that is still free on the chosen day.
        const taken = takenStarts(bookings, config, props.date);
        const free = slotOptions(config).find((s) => !taken.has(s));
        const start = free ?? config.opening_hour * 60;
        return {
            title: '',
            host_id: currentUserId,
            participant_ids: [] as string[],
            date: props.date,
            start_minute: start,
            end_minute: Math.min(start + config.slot_minutes, config.closing_hour * 60),
            notes: '',
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const [title, setTitle] = useState(defaults.title);
    const [hostId, setHostId] = useState(defaults.host_id);
    const [participantIds, setParticipantIds] = useState<string[]>(defaults.participant_ids);
    const [date, setDate] = useState(defaults.date);
    const [startMinute, setStartMinute] = useState(defaults.start_minute);
    const [endMinute, setEndMinute] = useState(defaults.end_minute);
    const [notes, setNotes] = useState(defaults.notes);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const taken = useMemo(
        () => takenStarts(bookings, config, date, editing?.id),
        [bookings, config, date, editing],
    );

    // Warn before the user submits, rather than letting the server reject it.
    const conflict = useMemo(
        () => findConflict(bookings, date, startMinute, endMinute, editing?.id),
        [bookings, date, startMinute, endMinute, editing],
    );

    const onStartChange = (value: number) => {
        setStartMinute(value);

        // Keep the end after the start, preserving the length where possible.
        const length = endMinute - startMinute;
        const closing = config.closing_hour * 60;
        setEndMinute(Math.min(value + Math.max(length, config.slot_minutes), closing));
    };

    const pastDate = isPastDate(date);
    const blocked = Boolean(conflict) || pastDate;

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving || blocked) {
            return;
        }
        if (!title.trim()) {
            setError('Give the meeting a title.');
            return;
        }
        if (!hostId) {
            setError('Choose a host.');
            return;
        }

        setSaving(true);
        setError('');
        try {
            const saved = await save({
                team_id: teamId,
                title: title.trim(),
                host_id: hostId,
                participant_ids: participantIds,
                date,
                start_minute: startMinute,
                end_minute: endMinute,
                notes: notes.trim(),
            });
            onSaved(saved);
        } catch (err) {
            // A 409 means someone claimed the slot between render and submit.
            const apiErr = err as ApiError;
            setError(apiErr.message || 'The booking could not be saved.');
            setSaving(false);
        }
    };

    return (
        <form
            className='brk-form'
            onSubmit={onSubmit}
        >
            <div className='brk-form__field'>
                <label htmlFor='brk-title'>{'Meeting title'}</label>
                <input
                    id='brk-title'
                    className='brk-input'
                    value={title}
                    maxLength={128}
                    placeholder='Weekly leadership sync'
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus={true}
                />
            </div>

            <div className='brk-form__field'>
                <label htmlFor='brk-host'>{'Host'}</label>
                <UserSelect
                    inputId='brk-host'
                    users={users}
                    selected={hostId ? [hostId] : []}
                    onChange={(ids) => setHostId(ids[0] || '')}
                    placeholder='Search for the host…'
                />
            </div>

            <div className='brk-form__field'>
                <label htmlFor='brk-participants'>{'Participants'}</label>
                <UserSelect
                    inputId='brk-participants'
                    users={users}
                    selected={participantIds}
                    onChange={setParticipantIds}
                    exclude={hostId ? [hostId] : []}
                    multi={true}
                    placeholder='Search for teammates…'
                />
            </div>

            <div className='brk-form__field'>
                <label htmlFor='brk-date'>{'Date'}</label>
                <input
                    id='brk-date'
                    className='brk-input'
                    type='date'
                    value={date}
                    min={todayString()}
                    onChange={(e) => setDate(e.target.value)}
                />
            </div>

            <div className='brk-form__row'>
                <div className='brk-form__field'>
                    <label htmlFor='brk-start'>{'From'}</label>
                    <select
                        id='brk-start'
                        className='brk-input'
                        value={startMinute}
                        onChange={(e) => onStartChange(Number(e.target.value))}
                    >
                        {slotOptions(config).map((slot) => (
                            <option
                                key={slot}
                                value={slot}
                                disabled={taken.has(slot)}
                            >
                                {formatMinute(slot) + (taken.has(slot) ? ' — booked' : '')}
                            </option>
                        ))}
                    </select>
                </div>

                <div className='brk-form__field'>
                    <label htmlFor='brk-end'>{'To'}</label>
                    <select
                        id='brk-end'
                        className='brk-input'
                        value={endMinute}
                        onChange={(e) => setEndMinute(Number(e.target.value))}
                    >
                        {endOptions(config, startMinute).map((slot) => (
                            <option
                                key={slot}
                                value={slot}
                            >
                                {formatMinute(slot)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className='brk-form__duration'>{formatDuration(endMinute - startMinute)}</div>

            <div className='brk-form__field'>
                <label htmlFor='brk-notes'>{'Notes'}</label>
                <textarea
                    id='brk-notes'
                    className='brk-input brk-textarea'
                    value={notes}
                    maxLength={1024}
                    rows={2}
                    placeholder='Agenda, dial-in details, anything useful…'
                    onChange={(e) => setNotes(e.target.value)}
                />
            </div>

            {conflict && (
                <div className='brk-alert brk-alert--warning'>
                    {`Already booked: “${conflict.title}” runs from ${formatMinute(conflict.start_minute)} to ${formatMinute(conflict.end_minute)}. Pick another time.`}
                </div>
            )}
            {pastDate && (
                <div className='brk-alert brk-alert--warning'>{'That date has already passed.'}</div>
            )}
            {error && <div className='brk-alert brk-alert--error'>{error}</div>}

            <div className='brk-form__actions'>
                <button
                    type='button'
                    className='brk-btn brk-btn--tertiary'
                    onClick={onCancel}
                >
                    {'Cancel'}
                </button>
                <button
                    type='submit'
                    className='brk-btn brk-btn--primary'
                    disabled={saving || blocked}
                >
                    {saving ? 'Saving…' : (editing ? 'Save changes' : 'Book the room')}
                </button>
            </div>
        </form>
    );
}
