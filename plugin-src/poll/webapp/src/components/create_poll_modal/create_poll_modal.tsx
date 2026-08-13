import React, { useState } from 'react';

interface Props {
    visible: boolean;
    channelId: string;
    onClose: () => void;
}

const getCsrfToken = () => {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'MMCSRF') {
            return value;
        }
    }
    return (window as any).mm_csrf || '';
};

export const CreatePollModal: React.FC<Props> = ({ visible, channelId, onClose }) => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState<string[]>(['', '']);
    const [multiple, setMultiple] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    if (!visible) return null;

    const handleOptionChange = (index: number, value: string) => {
        const updated = [...options];
        updated[index] = value;
        setOptions(updated);
    };

    const handleAddOption = () => {
        if (options.length >= 10) return;
        setOptions([...options, '']);
    };

    const handleRemoveOption = (index: number) => {
        if (options.length <= 2) return; // Keep minimum 2 options
        const updated = options.filter((_, idx) => idx !== index);
        setOptions(updated);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');

        const trimmedQuestion = question.trim();
        if (!trimmedQuestion) {
            setErrorMsg('Please enter a question');
            return;
        }

        const validOptions = options.map(o => o.trim()).filter(o => o !== '');
        if (validOptions.length < 2) {
            setErrorMsg('Please enter at least 2 options');
            return;
        }

        setSubmitting(true);

        try {
            const submission: Record<string, any> = {
                question: trimmedQuestion,
                multiple,
            };
            validOptions.forEach((opt, idx) => {
                submission[`option_${idx}`] = opt;
            });

            const csrfToken = getCsrfToken();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }

            const res = await fetch('/plugins/com.artslabcreatives.poll/api/v1/polls/create', {
                method: 'POST',
                headers,
                credentials: 'same-origin',
                body: JSON.stringify({
                    channel_id: channelId,
                    submission,
                }),
            });

            if (res.ok) {
                // Reset state and close modal
                setQuestion('');
                setOptions(['', '']);
                setMultiple(false);
                onClose();
            } else {
                const errData = await res.json().catch(() => ({}));
                setErrorMsg(errData.error || 'Failed to create poll');
            }
        } catch (err) {
            setErrorMsg('Network error. Failed to create poll.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
        }}>
            <div style={{
                width: '100%',
                maxWidth: '480px',
                backgroundColor: 'var(--center-channel-bg, #1e293b)',
                borderRadius: '16px',
                border: '1px solid var(--center-channel-color-10, rgba(255, 255, 255, 0.12))',
                boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                color: 'var(--center-channel-color, #e2e8f0)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '90vh',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            }}>
                {/* Modal Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--center-channel-color-10, rgba(255, 255, 255, 0.08))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--center-channel-color, #f8fafc)' }}>
                        Create a WhatsApp Poll
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--center-channel-color-50, #94a3b8)',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '4px',
                            lineHeight: 1,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Modal Body */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
                    {errorMsg && (
                        <div style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#f87171',
                            fontSize: '13px',
                            marginBottom: '16px',
                        }}>
                            {errorMsg}
                        </div>
                    )}

                    {/* Question Field */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#cbd5e1' }}>
                            Question <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="Ask a question..."
                            style={{
                                width: '100%',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                background: 'var(--center-channel-color-05, rgba(255,255,255,0.05))',
                                border: '1px solid var(--center-channel-color-20, rgba(255,255,255,0.15))',
                                color: 'var(--center-channel-color, #f8fafc)',
                                fontSize: '14px',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Dynamic Options List */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#cbd5e1' }}>
                            Options <span style={{ color: '#ef4444' }}>*</span>
                        </label>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {options.map((opt, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={opt}
                                        onChange={(e) => handleOptionChange(idx, e.target.value)}
                                        placeholder={`Option ${idx + 1} ${idx < 2 ? '*' : '(Optional)'}`}
                                        style={{
                                            flex: 1,
                                            padding: '10px 14px',
                                            borderRadius: '8px',
                                            background: 'var(--center-channel-color-05, rgba(255,255,255,0.05))',
                                            border: '1px solid var(--center-channel-color-20, rgba(255,255,255,0.15))',
                                            color: 'var(--center-channel-color, #f8fafc)',
                                            fontSize: '14px',
                                            outline: 'none',
                                            boxSizing: 'border-box',
                                        }}
                                    />
                                    {options.length > 2 && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveOption(idx)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: '#ef4444',
                                                fontSize: '16px',
                                                cursor: 'pointer',
                                                padding: '6px',
                                                borderRadius: '6px',
                                            }}
                                            title="Remove Option"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* "+ Add Option" Button */}
                        {options.length < 10 && (
                            <button
                                type="button"
                                onClick={handleAddOption}
                                style={{
                                    marginTop: '12px',
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    border: '1px dashed #3b82f6',
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    color: '#60a5fa',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    width: '100%',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <span>+</span> Add Option
                            </button>
                        )}
                    </div>

                    {/* Allow Multiple Select Checkbox */}
                    <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                            type="checkbox"
                            id="multiple_checkbox"
                            checked={multiple}
                            onChange={(e) => setMultiple(e.target.checked)}
                            style={{
                                width: '18px',
                                height: '18px',
                                cursor: 'pointer',
                                accentColor: '#166de0',
                            }}
                        />
                        <label htmlFor="multiple_checkbox" style={{ fontSize: '13.5px', color: '#cbd5e1', cursor: 'pointer', userSelect: 'none' }}>
                            Allow multiple answers
                        </label>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--center-channel-color-10, rgba(255,255,255,0.08))' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '10px 18px',
                                borderRadius: '8px',
                                border: '1px solid var(--center-channel-color-20, rgba(255,255,255,0.2))',
                                background: 'transparent',
                                color: 'var(--center-channel-color, #e2e8f0)',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: 'none',
                                background: '#166de0',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            {submitting ? 'Creating...' : 'Create Poll'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
