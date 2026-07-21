import {useEffect, useMemo, useRef, useState} from 'react';

import {avatarUrl, displayName} from '../mattermost';
import {UserProfile} from '../types';

interface Props {
    users: UserProfile[];
    selected: string[];
    onChange: (userIds: string[]) => void;
    multi?: boolean;
    placeholder: string;
    exclude?: string[];
    inputId?: string;
}

function matches(user: UserProfile, term: string): boolean {
    const haystack = `${user.username} ${user.first_name} ${user.last_name} ${user.nickname}`.toLowerCase();
    return haystack.includes(term);
}

/**
 * Searchable people picker. Doubles as the single-select host field and the
 * multi-select participants field so both behave identically.
 */
export default function UserSelect(props: Props) {
    const {users, selected, onChange, multi, placeholder, exclude = [], inputId} = props;

    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

    const candidates = useMemo(() => {
        const search = term.trim().toLowerCase();
        return users.
            filter((u) => !selected.includes(u.id) && !exclude.includes(u.id)).
            filter((u) => !search || matches(u, search)).
            slice(0, 50);
    }, [users, selected, exclude, term]);

    // Keep the highlighted row in range as the list narrows while typing.
    useEffect(() => {
        setActiveIndex(0);
    }, [term]);

    // Clicking anywhere else should dismiss the dropdown.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onDocumentDown = (e: MouseEvent) => {
            if (!containerRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocumentDown);
        return () => document.removeEventListener('mousedown', onDocumentDown);
    }, [open]);

    const select = (userId: string) => {
        onChange(multi ? [...selected, userId] : [userId]);
        setTerm('');
        setOpen(Boolean(multi));
    };

    const remove = (userId: string) => onChange(selected.filter((id) => id !== userId));

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && open && candidates[activeIndex]) {
            // Enter picks a person rather than submitting the half-built form.
            e.preventDefault();
            select(candidates[activeIndex].id);
        } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
        } else if (e.key === 'Backspace' && !term && selected.length) {
            remove(selected[selected.length - 1]);
        }
    };

    const chips = selected.map((id) => byId.get(id)).filter(Boolean) as UserProfile[];
    const showInput = multi || selected.length === 0;

    return (
        <div
            className='brk-select'
            ref={containerRef}
        >
            <div
                className='brk-select__control'
                onClick={() => setOpen(true)}
            >
                {chips.map((user) => (
                    <span
                        className='brk-chip'
                        key={user.id}
                    >
                        <img
                            className='brk-chip__avatar'
                            src={avatarUrl(user.id)}
                            alt=''
                        />
                        <span className='brk-chip__name'>{displayName(user)}</span>
                        <button
                            type='button'
                            className='brk-chip__remove'
                            aria-label={`Remove ${displayName(user)}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                remove(user.id);
                            }}
                        >
                            {'×'}
                        </button>
                    </span>
                ))}
                {showInput && (
                    <input
                        id={inputId}
                        className='brk-select__input'
                        value={term}
                        placeholder={chips.length ? 'Add another…' : placeholder}
                        onChange={(e) => {
                            setTerm(e.target.value);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onKeyDown}
                        autoComplete='off'
                    />
                )}
            </div>

            {open && candidates.length > 0 && (
                <ul className='brk-select__menu'>
                    {candidates.map((user, index) => (
                        <li key={user.id}>
                            <button
                                type='button'
                                className={`brk-select__option${index === activeIndex ? ' is-active' : ''}`}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => select(user.id)}
                            >
                                <img
                                    className='brk-select__avatar'
                                    src={avatarUrl(user.id)}
                                    alt=''
                                />
                                <span className='brk-select__label'>{displayName(user)}</span>
                                <span className='brk-select__username'>{`@${user.username}`}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {open && term.trim() && candidates.length === 0 && (
                <div className='brk-select__empty'>{'No matching people'}</div>
            )}
        </div>
    );
}
