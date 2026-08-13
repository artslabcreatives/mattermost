import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface PollData {
    id: string;
    created_at: number;
    user_id: string;
    channel_id: string;
    question: string;
    options: string[];
    votes: { [key: string]: string[] };
    multiple: boolean;
    ended: boolean;
}

interface Props {
    post: any;
    currentUserId: string;
}

const getCsrfToken = () => {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'MMCSRF') return value;
    }
    return (window as any).mm_csrf || '';
};

const doFetch = async (url: string, body: any) => {
    const csrfToken = getCsrfToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return fetch(url, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
};

/* ── Custom Confirmation Modal (Portal) ── */
const ConfirmModal: React.FC<{
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: string;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ visible, title, message, confirmLabel, confirmColor, onConfirm, onCancel }) => {
    if (!visible) return null;
    return ReactDOM.createPortal(
        <div onClick={(e) => { e.stopPropagation(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999 }}>
            <div style={{ width: '100%', maxWidth: '400px', background: 'var(--center-channel-bg, #1e293b)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)', padding: '24px', color: 'var(--center-channel-color, #e2e8f0)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
                <div style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 600 }}>{title}</div>
                <div style={{ margin: '0 0 20px', fontSize: '14px', color: '#94a3b8', lineHeight: 1.5 }}>{message}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#e2e8f0', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={(e) => { e.stopPropagation(); onConfirm(); }} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: confirmColor, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{confirmLabel}</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

/* ── Edit Poll Modal (Portal) ── */
const EditPollModal: React.FC<{
    visible: boolean;
    poll: PollData;
    onSave: (q: string, opts: string[], multi: boolean) => void;
    onCancel: () => void;
}> = ({ visible, poll, onSave, onCancel }) => {
    const [question, setQuestion] = useState(poll.question);
    const [options, setOptions] = useState<string[]>([...poll.options]);
    const [multiple, setMultiple] = useState(poll.multiple);

    useEffect(() => {
        if (visible) {
            setQuestion(poll.question);
            setOptions([...poll.options]);
            setMultiple(poll.multiple);
        }
    }, [visible, poll]);

    if (!visible) return null;

    const handleOptionChange = (i: number, v: string) => { const u = [...options]; u[i] = v; setOptions(u); };
    const handleAddOption = () => { if (options.length < 10) setOptions([...options, '']); };
    const handleRemoveOption = (i: number) => { if (options.length > 2) setOptions(options.filter((_, idx) => idx !== i)); };

    const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#f8fafc', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const };

    return ReactDOM.createPortal(
        <div onClick={(e) => { e.stopPropagation(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999, padding: '16px' }}>
            <div style={{ width: '100%', maxWidth: '480px', background: 'var(--center-channel-bg, #1e293b)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', color: '#e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Edit Poll</div>
                    <button onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>✕</button>
                </div>
                {/* Body */}
                <div style={{ padding: '24px', overflowY: 'auto' }}>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#cbd5e1' }}>Question</label>
                        <input type="text" value={question} onChange={e => setQuestion(e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#cbd5e1' }}>Options</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {options.map((opt, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="text" value={opt} onChange={e => handleOptionChange(idx, e.target.value)} placeholder={`Option ${idx + 1}`} style={{ ...inputStyle, flex: 1 }} />
                                    {options.length > 2 && (
                                        <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveOption(idx); }} style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '16px', cursor: 'pointer', padding: '6px' }}>🗑️</button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {options.length < 10 && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleAddOption(); }} style={{ marginTop: '12px', padding: '8px 14px', borderRadius: '8px', border: '1px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: 'center' }}>
                                <span>+</span> Add Option
                            </button>
                        )}
                    </div>
                    <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#166de0' }} />
                        <label style={{ fontSize: '13.5px', color: '#cbd5e1', cursor: 'pointer' }}>Allow multiple answers</label>
                    </div>
                </div>
                {/* Footer */}
                <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#e2e8f0', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={(e) => { e.stopPropagation(); onSave(question, options, multiple); }} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#166de0', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Save Changes</button>
                </div>
            </div>
        </div>,
        document.body
    );
};

/* ── Main Poll Post Component ── */
export const PollPost: React.FC<Props> = ({ post, currentUserId }) => {
    const poll: PollData = post?.props?.poll;
    const [loading, setLoading] = useState(false);
    const [localPoll, setLocalPoll] = useState<PollData | null>(poll);
    const [confirmModal, setConfirmModal] = useState<{ type: 'end' | 'delete'; visible: boolean }>({ type: 'end', visible: false });
    const [editModal, setEditModal] = useState(false);

    useEffect(() => { if (post?.props?.poll) setLocalPoll(post.props.poll); }, [post?.props?.poll]);

    const activePoll = localPoll || poll;
    if (!activePoll || !activePoll.options) return <div style={{ padding: '10px', color: '#888' }}>Loading poll data...</div>;

    const votes = activePoll.votes || {};
    const votedUsers = new Set<string>();
    Object.values(votes).forEach(ul => { if (Array.isArray(ul)) ul.forEach(uid => votedUsers.add(uid)); });
    const totalVotes = votedUsers.size;

    // Get active user ID safely
    const effectiveUserId = currentUserId || (window as any).mm_current_user_id || '';
    const isCreator = effectiveUserId === activePoll.user_id;

    const handleVote = async (optIdx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (activePoll.ended || loading) return;
        setLoading(true);
        try {
            const res = await doFetch('/plugins/com.artslabcreatives.poll/api/v1/polls/vote', { poll_id: activePoll.id, option_idx: String(optIdx) });
            if (res.ok) { const updated = await res.json(); setLocalPoll(updated); }
        } catch (err) { console.error('Vote failed', err); }
        finally { setLoading(false); }
    };

    const handleEndPoll = async () => {
        setConfirmModal({ type: 'end', visible: false });
        setLoading(true);
        try {
            const res = await doFetch('/plugins/com.artslabcreatives.poll/api/v1/polls/end', { poll_id: activePoll.id });
            if (res.ok) { const updated = await res.json(); setLocalPoll(updated); }
        } catch (err) { console.error('End poll failed', err); }
        finally { setLoading(false); }
    };

    const handleDeletePoll = async () => {
        setConfirmModal({ type: 'delete', visible: false });
        setLoading(true);
        try { await doFetch('/plugins/com.artslabcreatives.poll/api/v1/polls/delete', { poll_id: activePoll.id }); }
        catch (err) { console.error('Delete poll failed', err); }
        finally { setLoading(false); }
    };

    const handleEditPoll = async (question: string, options: string[], multiple: boolean) => {
        setEditModal(false);
        setLoading(true);
        try {
            const res = await doFetch('/plugins/com.artslabcreatives.poll/api/v1/polls/edit', { poll_id: activePoll.id, question, options, multiple });
            if (res.ok) { const updated = await res.json(); setLocalPoll(updated); }
        } catch (err) { console.error('Edit poll failed', err); }
        finally { setLoading(false); }
    };

    return (
        <div onClick={(e) => { e.stopPropagation(); }}>
            {/* Confirmation Modals (Portals) */}
            <ConfirmModal
                visible={confirmModal.visible && confirmModal.type === 'end'}
                title="End Poll"
                message="Are you sure you want to end this poll? No more votes will be accepted after this."
                confirmLabel="End Poll"
                confirmColor="#f59e0b"
                onConfirm={handleEndPoll}
                onCancel={() => setConfirmModal({ ...confirmModal, visible: false })}
            />
            <ConfirmModal
                visible={confirmModal.visible && confirmModal.type === 'delete'}
                title="Delete Poll"
                message="Are you sure you want to delete this poll? This action cannot be undone and the post will be permanently removed."
                confirmLabel="Delete"
                confirmColor="#dc2626"
                onConfirm={handleDeletePoll}
                onCancel={() => setConfirmModal({ ...confirmModal, visible: false })}
            />
            {/* Edit Poll Modal (Portal) */}
            {editModal && <EditPollModal visible={editModal} poll={activePoll} onSave={handleEditPoll} onCancel={() => setEditModal(false)} />}

            {/* Poll Card */}
            <div style={{ maxWidth: '520px', borderRadius: '16px', background: 'var(--center-channel-bg, #1e293b)', border: '1px solid var(--center-channel-color-10, rgba(255,255,255,0.12))', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', padding: '20px', color: 'var(--center-channel-color, #e2e8f0)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '8px 0' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div style={{ margin: 0, fontSize: '17px', fontWeight: 600, lineHeight: '1.4', color: 'var(--center-channel-color, #f8fafc)', flex: 1 }}>{activePoll.question}</div>
                    {isCreator && !activePoll.ended && (
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditModal(true); }} style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', fontSize: '12px', fontWeight: 500, padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', marginLeft: '12px', whiteSpace: 'nowrap' }}>Edit</button>
                    )}
                </div>

                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', background: activePoll.multiple ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)', color: activePoll.multiple ? '#60a5fa' : '#34d399', fontSize: '11px', fontWeight: 500 }}>
                        {activePoll.multiple ? 'Select one or more' : 'Select one'}
                    </span>
                    {activePoll.ended && <span style={{ padding: '2px 8px', borderRadius: '12px', background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '11px', fontWeight: 500 }}>Ended</span>}
                </div>

                {/* Options */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {activePoll.options.map((optText, idx) => {
                        const optKey = String(idx);
                        const optUserList = votes[optKey] || [];
                        const optVoteCount = optUserList.length;
                        const hasVotedThisOpt = effectiveUserId ? optUserList.includes(effectiveUserId) : false;
                        const percentage = totalVotes > 0 ? Math.round((optVoteCount / totalVotes) * 100) : 0;

                        return (
                            <div key={idx} onClick={(e) => handleVote(idx, e)} style={{ position: 'relative', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: hasVotedThisOpt ? '1.5px solid #10b981' : '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', cursor: activePoll.ended ? 'default' : 'pointer', overflow: 'hidden', transition: 'all 0.2s ease', userSelect: 'none' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${percentage}%`, background: hasVotedThisOpt ? 'rgba(16,185,129,0.25)' : 'rgba(59,130,246,0.12)', transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)', borderRadius: '10px 0 0 10px' }} />
                                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, marginRight: '12px' }}>
                                        <div style={{ width: '18px', height: '18px', borderRadius: activePoll.multiple ? '4px' : '50%', border: hasVotedThisOpt ? '2px solid #10b981' : '2px solid #64748b', background: hasVotedThisOpt ? '#10b981' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s ease' }}>
                                            {hasVotedThisOpt && <span style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                                        </div>
                                        <span style={{ fontSize: '14px', fontWeight: hasVotedThisOpt ? 600 : 400, color: '#f1f5f9', wordBreak: 'break-word' }}>{optText}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>{optVoteCount}</span>
                                        <span style={{ fontSize: '12px', color: '#64748b' }}>({percentage}%)</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: '#94a3b8' }}>
                    <div>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</div>
                    {isCreator && !activePoll.ended && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmModal({ type: 'end', visible: true }); }} disabled={loading} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.4)', background: 'transparent', color: '#f59e0b', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>End Poll</button>
                            <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmModal({ type: 'delete', visible: true }); }} disabled={loading} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>Delete</button>
                        </div>
                    )}
                    {isCreator && activePoll.ended && (
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmModal({ type: 'delete', visible: true }); }} disabled={loading} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>Delete Poll</button>
                    )}
                </div>
            </div>
        </div>
    );
};
