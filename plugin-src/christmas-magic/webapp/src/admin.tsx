import React, {useEffect, useState} from 'react';

import {useSnapshot} from './app';
import type {Controller} from './controller';
import styles from './style.css';

// System Console list of every Christmas wish, newest first, with removal for moderation.
export default function WishesAdmin({controller}: {controller: Controller}) {
    const {wishes} = useSnapshot(controller);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        void controller.reloadWishes();
    }, [controller]);

    const remove = async (id: string) => {
        if (!id && !window.confirm(`Remove all ${wishes.length} Christmas wishes? This cannot be undone.`)) return;
        setBusy(true);
        setError('');
        try {
            const response = await controller.api(id ? `/wishes/${encodeURIComponent(id)}` : '/wishes', {method: 'DELETE'});
            if (!response.ok) throw new Error(await response.text());
            controller.removeWishes(id);
        } catch (err) {
            setError(`Could not remove: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusy(false);
        }
    };

    const newestFirst = [...wishes].reverse();
    return <div className='cm-admin'>
        <style>{styles}</style>
        <div className='cm-admin-bar'>
            <span>{wishes.length === 1 ? '1 wish' : `${wishes.length} wishes`}</span>
            {wishes.length > 0 && <button type='button' className='btn btn-sm btn-danger' disabled={busy} onClick={() => remove('')}>Remove all</button>}
        </div>
        {error && <div className='cm-admin-error' role='alert'>{error}</div>}
        {newestFirst.length === 0 ? <p className='cm-admin-empty'>No wishes yet. Users can send one by typing <code>/christmas</code> followed by their wish.</p> :
            <div className='cm-admin-scroll'>
                <table className='cm-admin-table'>
                    <thead><tr><th>From</th><th>Wish</th><th>Sent</th><th/></tr></thead>
                    <tbody>{newestFirst.map((wish) => <tr key={wish.id}>
                        <td>{wish.name}</td>
                        <td>{wish.message}</td>
                        <td>{new Date(wish.create_at).toLocaleString()}</td>
                        <td><button type='button' className='btn btn-sm btn-tertiary' disabled={busy} onClick={() => remove(wish.id)} aria-label={`Remove wish from ${wish.name}`}>Remove</button></td>
                    </tr>)}</tbody>
                </table>
            </div>}
    </div>;
}
