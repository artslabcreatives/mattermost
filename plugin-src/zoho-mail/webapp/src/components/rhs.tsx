import React, { useState, useEffect, useCallback } from 'react';

import manifest from '../../../plugin.json';

const apiBase = () => `${(window as any).basename || ''}/plugins/${manifest.id}/api/v1`;

interface Email {
    messageId: string;
    folderId: string;
    sender: string;
    fromAddress: string;
    subject: string;
    summary: string;
    receivedTime: string;
    status2: string;
}

interface Folder {
    folderId: string;
    folderName: string;
    messageCount: number;
    unreadCount: number;
}

const ACCENT_COLORS = ['#2b7bea', '#e8433e', '#f5a623', '#7b61ff', '#00b894', '#e17055', '#0984e3', '#6c5ce7'];

function getAccentColor(sender: string): string {
    let hash = 0;
    for (let i = 0; i < sender.length; i++) {
        hash = sender.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

function getInitials(sender: string): string {
    if (!sender) return '?';
    const clean = sender.replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
    const parts = clean.split(/[\s@.]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase();
}

function formatDate(timestamp: string): string {
    const d = new Date(parseInt(timestamp));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (isYesterday) {
        return 'Yesterday';
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function decodeHtml(html: string): string {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
}

// Folder icons mapping
const FOLDER_ICONS: Record<string, string> = {
    'inbox': '📥',
    'sent': '📤',
    'drafts': '📝',
    'spam': '⚠️',
    'trash': '🗑️',
    'archive': '📦',
    'outbox': '📬',
    'templates': '📋',
    'snoozed': '⏰',
    'newsletter': '📰',
    'notification': '🔔',
};

function getFolderIcon(name: string): string {
    return FOLDER_ICONS[name.toLowerCase()] || '📁';
}

export default function RHS() {
    const [connected, setConnected] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [emails, setEmails] = useState<Email[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<any>(null);
    const [selectedEmailMeta, setSelectedEmailMeta] = useState<{sender: string, subject: string, fromAddress: string, receivedTime: string, folderId: string, messageId: string} | null>(null);
    const [composing, setComposing] = useState<boolean>(false);
    const [sendTo, setSendTo] = useState<string>('');
    const [sendSubject, setSendSubject] = useState<string>('');
    const [sendBody, setSendBody] = useState<string>('');
    const [sending, setSending] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [activeFolder, setActiveFolder] = useState<string>('Inbox');

    const checkAuth = async () => {
        try {
            const resp = await fetch(`${apiBase()}/check-auth`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                setConnected(data.connected);
                if (data.connected) {
                    await loadFolders();
                    await loadEmails('Inbox');
                } else {
                    setLoading(false);
                }
            } else {
                setLoading(false);
            }
        } catch (err) {
            setLoading(false);
        }
    };

    const loadFolders = async () => {
        try {
            const resp = await fetch(`${apiBase()}/folders`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.data) {
                    setFolders(data.data);
                }
            }
        } catch (err) {
            // silently fail, use default tabs
        }
    };

    const loadEmails = async (folderName?: string) => {
        setLoading(true);
        setErrorMsg('');
        const folder = folderName || activeFolder;
        try {
            const resp = await fetch(`${apiBase()}/emails?folder=${encodeURIComponent(folder)}`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.data) {
                    setEmails(data.data);
                } else if (Array.isArray(data)) {
                    setEmails(data);
                } else {
                    setEmails([]);
                }
            } else {
                setErrorMsg('Failed to load emails.');
            }
        } catch (err) {
            setErrorMsg('Network error loading emails.');
        }
        setLoading(false);
    };

    const handleFolderClick = (folderName: string) => {
        setActiveFolder(folderName);
        setEmails([]);
        loadEmails(folderName);
    };

    const loadEmailDetail = async (email: Email) => {
        setLoading(true);
        setErrorMsg('');
        // Store the email metadata so detail view has subject/sender
        setSelectedEmailMeta({
            sender: email.sender,
            subject: email.subject,
            fromAddress: email.fromAddress || email.sender,
            receivedTime: email.receivedTime,
            folderId: email.folderId,
            messageId: email.messageId,
        });
        try {
            const resp = await fetch(`${apiBase()}/email-detail?id=${email.messageId}&folderId=${email.folderId}`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                setSelectedEmail(data.data || data);
            } else {
                setErrorMsg('Failed to load email details.');
            }
        } catch (err) {
            setErrorMsg('Failed to load email details.');
        }
        setLoading(false);
    };

    const handleConnect = () => {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        window.open(
            `${apiBase()}/auth`,
            'Connect Zoho Mail',
            `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
        );
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect your Zoho Mail account?')) return;
        setLoading(true);
        try {
            await fetch(`${apiBase()}/disconnect`, { method: 'POST', credentials: 'include' });
            setConnected(false);
            setEmails([]);
            setFolders([]);
            setSelectedEmail(null);
            setSelectedEmailMeta(null);
        } catch (err) {
            alert('Failed to disconnect account.');
        }
        setLoading(false);
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!sendTo || !sendSubject || !sendBody) {
            alert('Please fill in all fields.');
            return;
        }
        setSending(true);
        try {
            const resp = await fetch(`${apiBase()}/send`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toAddress: sendTo, subject: sendSubject, content: sendBody })
            });
            if (resp.ok) {
                alert('Email sent successfully!');
                setSendTo(''); setSendSubject(''); setSendBody('');
                setComposing(false);
                loadEmails();
            } else {
                alert('Failed to send email.');
            }
        } catch (err) {
            alert('Error sending email.');
        }
        setSending(false);
    };

    useEffect(() => {
        checkAuth();
        const handleMessage = (e: MessageEvent) => {
            if (e.data && e.data.type === 'zoho-connected') {
                setConnected(true);
                loadFolders();
                loadEmails('Inbox');
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Determine which folders to show as tabs
    const displayFolders = folders.length > 0
        ? folders.filter(f => ['inbox', 'sent', 'drafts', 'spam', 'trash', 'outbox'].includes(f.folderName.toLowerCase()))
        : [
            { folderId: '', folderName: 'Inbox', messageCount: 0, unreadCount: 0 },
            { folderId: '', folderName: 'Sent', messageCount: 0, unreadCount: 0 },
            { folderId: '', folderName: 'Drafts', messageCount: 0, unreadCount: 0 },
            { folderId: '', folderName: 'Spam', messageCount: 0, unreadCount: 0 },
            { folderId: '', folderName: 'Trash', messageCount: 0, unreadCount: 0 },
          ];

    // ─── Styles ───
    const css = {
        root: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column' as const,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Ubuntu, "Droid Sans", "Helvetica Neue", sans-serif',
            fontSize: '13px',
            color: 'var(--center-channel-color, #d5d5d5)',
            backgroundColor: 'var(--center-channel-bg, #1b2028)',
            overflow: 'hidden',
        },
        toolbar: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderBottom: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))',
        },
        newMailBtn: {
            padding: '7px 18px',
            borderRadius: '4px',
            border: 'none',
            background: 'linear-gradient(135deg, #e8433e 0%, #d63031 100%)',
            color: '#fff',
            fontWeight: '600' as const,
            fontSize: '13px',
            cursor: 'pointer',
            letterSpacing: '0.3px',
            boxShadow: '0 2px 8px rgba(232,67,62,0.3)',
            transition: 'all 0.2s',
        },
        toolbarRight: {
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
        },
        iconBtn: {
            background: 'none',
            border: 'none',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.45))',
            cursor: 'pointer',
            padding: '4px 6px',
            fontSize: '14px',
            borderRadius: '4px',
            transition: 'background 0.15s',
        },
        disconnectBtn: {
            background: 'none',
            border: '1px solid var(--center-channel-color-16, rgba(255,255,255,0.12))',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.5))',
            cursor: 'pointer',
            padding: '4px 10px',
            fontSize: '11px',
            borderRadius: '4px',
        },
        folderBar: {
            display: 'flex',
            alignItems: 'center',
            gap: '0',
            padding: '0 4px',
            borderBottom: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))',
            overflowX: 'auto' as const,
            flexShrink: 0,
        },
        folderTab: (active: boolean) => ({
            padding: '9px 12px',
            fontSize: '12px',
            fontWeight: active ? '600' : '400' as const,
            color: active ? '#2b7bea' : 'var(--center-channel-color-56, rgba(255,255,255,0.5))',
            background: 'none',
            border: 'none',
            borderBottom: active ? '2px solid #2b7bea' : '2px solid transparent',
            cursor: 'pointer',
            whiteSpace: 'nowrap' as const,
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
        }),
        folderBadge: {
            fontSize: '10px',
            fontWeight: '600' as const,
            backgroundColor: 'rgba(43,123,234,0.15)',
            color: '#2b7bea',
            borderRadius: '8px',
            padding: '1px 5px',
            marginLeft: '2px',
        },
        emailList: {
            flex: 1,
            overflowY: 'auto' as const,
        },
        emailRow: (isUnread: boolean) => ({
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 14px',
            borderBottom: '1px solid var(--center-channel-color-04, rgba(255,255,255,0.03))',
            cursor: 'pointer',
            transition: 'background 0.12s',
            borderLeft: '3px solid transparent',
            backgroundColor: isUnread ? 'var(--center-channel-color-04, rgba(43,123,234,0.04))' : 'transparent',
        }),
        avatar: (color: string) => ({
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: color,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: '600' as const,
            flexShrink: 0,
            marginTop: '2px',
        }),
        emailBody: {
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
        },
        emailHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '2px',
        },
        emailSender: (isUnread: boolean) => ({
            fontSize: '13px',
            fontWeight: isUnread ? '700' : '400' as const,
            color: 'var(--center-channel-color, #e0e0e0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
        }),
        emailDate: {
            fontSize: '11px',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.4))',
            whiteSpace: 'nowrap' as const,
            marginLeft: '8px',
            flexShrink: 0,
        },
        emailSubject: (isUnread: boolean) => ({
            fontSize: '13px',
            fontWeight: isUnread ? '600' : '400' as const,
            color: 'var(--center-channel-color, #ccc)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            marginBottom: '2px',
        }),
        emailSnippet: {
            fontSize: '12px',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.35))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
            lineHeight: '1.4',
        },
        // Detail view
        detailToolbar: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderBottom: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))',
        },
        detailSubject: {
            fontSize: '15px',
            fontWeight: '600' as const,
            color: 'var(--center-channel-color, #e0e0e0)',
            padding: '12px 16px 6px',
            lineHeight: '1.3',
        },
        detailMetaRow: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 16px 12px',
            borderBottom: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))',
        },
        detailSenderName: {
            fontWeight: '600' as const,
            fontSize: '13px',
            color: 'var(--center-channel-color, #e0e0e0)',
        },
        detailSenderEmail: {
            fontSize: '12px',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.4))',
        },
        detailTime: {
            fontSize: '11px',
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.4))',
            marginLeft: 'auto',
        },
        detailBody: {
            flex: 1,
            overflowY: 'auto' as const,
            padding: '16px',
            lineHeight: '1.6',
            fontSize: '13px',
            color: 'var(--center-channel-color, #d0d0d0)',
            wordBreak: 'break-word' as const,
        },
        // Compose
        composeWrap: {
            flex: 1,
            overflowY: 'auto' as const,
            padding: '16px',
        },
        inputLabel: {
            display: 'block',
            fontSize: '12px',
            fontWeight: '500' as const,
            color: 'var(--center-channel-color-56, rgba(255,255,255,0.5))',
            marginBottom: '4px',
            marginTop: '10px',
        },
        input: {
            width: '100%',
            padding: '8px 10px',
            borderRadius: '4px',
            border: '1px solid var(--center-channel-color-16, rgba(255,255,255,0.12))',
            backgroundColor: 'var(--center-channel-color-04, rgba(255,255,255,0.04))',
            color: 'var(--center-channel-color, #e0e0e0)',
            fontSize: '13px',
            outline: 'none',
            boxSizing: 'border-box' as const,
        },
        textarea: {
            width: '100%',
            height: '180px',
            padding: '8px 10px',
            borderRadius: '4px',
            border: '1px solid var(--center-channel-color-16, rgba(255,255,255,0.12))',
            backgroundColor: 'var(--center-channel-color-04, rgba(255,255,255,0.04))',
            color: 'var(--center-channel-color, #e0e0e0)',
            fontSize: '13px',
            outline: 'none',
            resize: 'vertical' as const,
            boxSizing: 'border-box' as const,
        },
        sendBtn: {
            marginTop: '12px',
            padding: '8px 24px',
            borderRadius: '4px',
            border: 'none',
            background: 'linear-gradient(135deg, #2b7bea 0%, #1a6dd6 100%)',
            color: '#fff',
            fontWeight: '600' as const,
            fontSize: '13px',
            cursor: 'pointer',
        },
        connectWrap: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            textAlign: 'center' as const,
            padding: '40px 24px',
        },
        connectBtn: {
            padding: '10px 28px',
            borderRadius: '4px',
            border: 'none',
            background: 'linear-gradient(135deg, #e8433e 0%, #d63031 100%)',
            color: '#fff',
            fontWeight: '600' as const,
            fontSize: '14px',
            cursor: 'pointer',
            marginTop: '16px',
            boxShadow: '0 2px 12px rgba(232,67,62,0.3)',
        },
        backBtn: {
            background: 'none',
            border: 'none',
            color: '#2b7bea',
            cursor: 'pointer',
            padding: '0',
            fontSize: '13px',
            fontWeight: '500' as const,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
        },
        loadingBar: {
            height: '2px',
            background: 'linear-gradient(90deg, transparent, #2b7bea, transparent)',
            animation: 'loadingSlide 1.2s infinite',
        },
    };

    // ─── Loading state ───
    if (loading && emails.length === 0 && connected && !selectedEmail) {
        return (
            <div style={{...css.root, justifyContent: 'center', alignItems: 'center'}}>
                <div style={{fontSize: '13px', color: 'var(--center-channel-color-56)'}}>Loading...</div>
            </div>
        );
    }

    // ─── Connect screen ───
    if (!connected) {
        return (
            <div style={css.root}>
                <div style={css.connectWrap}>
                    <div style={{fontSize: '48px', marginBottom: '16px'}}>📧</div>
                    <div style={{fontSize: '18px', fontWeight: '600', marginBottom: '6px', color: 'var(--center-channel-color)'}}>
                        Zoho Mail
                    </div>
                    <div style={{fontSize: '13px', color: 'var(--center-channel-color-56)', maxWidth: '260px', lineHeight: '1.5'}}>
                        Connect your Zoho Mail account to view and manage your emails directly inside Mattermost.
                    </div>
                    <button style={css.connectBtn} onClick={handleConnect}>
                        Connect Account
                    </button>
                </div>
            </div>
        );
    }

    // ─── Compose view ───
    if (composing) {
        return (
            <div style={css.root}>
                <div style={css.toolbar}>
                    <button style={css.backBtn} onClick={() => setComposing(false)}>
                        ← Back
                    </button>
                    <span style={{fontWeight: '600', marginLeft: '8px'}}>New Mail</span>
                </div>
                <div style={css.composeWrap}>
                    <form onSubmit={handleSend}>
                        <label style={{...css.inputLabel, marginTop: '0'}}>To</label>
                        <input type="email" placeholder="recipient@example.com" style={css.input} value={sendTo} onChange={(e) => setSendTo(e.target.value)} required />
                        <label style={css.inputLabel}>Subject</label>
                        <input type="text" placeholder="Subject" style={css.input} value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} required />
                        <label style={css.inputLabel}>Message</label>
                        <textarea placeholder="Write your message..." style={css.textarea} value={sendBody} onChange={(e) => setSendBody(e.target.value)} required />
                        <button type="submit" style={css.sendBtn} disabled={sending}>
                            {sending ? 'Sending...' : 'Send'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ─── Email detail view ───
    if (selectedEmail) {
        const meta = selectedEmailMeta;
        const senderName = meta?.sender || selectedEmail.sender || selectedEmail.fromAddress || 'Unknown';
        const senderEmail = meta?.fromAddress || selectedEmail.fromAddress || '';
        const subject = meta?.subject || selectedEmail.subject || '(No Subject)';
        const time = meta?.receivedTime || selectedEmail.receivedTime || '';
        const color = getAccentColor(senderName);

        return (
            <div style={css.root}>
                {/* Toolbar */}
                <div style={css.detailToolbar}>
                    <button style={css.backBtn} onClick={() => { setSelectedEmail(null); setSelectedEmailMeta(null); }}>
                        ← {activeFolder}
                    </button>
                </div>

                {/* Subject */}
                <div style={css.detailSubject}>{subject}</div>

                {/* Sender info */}
                <div style={css.detailMetaRow}>
                    <div style={css.avatar(color)}>{getInitials(senderName)}</div>
                    <div>
                        <div style={css.detailSenderName}>{senderName}</div>
                        {senderEmail && senderEmail !== senderName && (
                            <div style={css.detailSenderEmail}>{senderEmail}</div>
                        )}
                    </div>
                    {time && <div style={css.detailTime}>{formatDate(time)}</div>}
                </div>

                {/* Scrollable Container for Body and Attachments */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {loading ? (
                        <div style={{padding: '20px', textAlign: 'center', color: 'var(--center-channel-color-56)'}}>Loading...</div>
                    ) : (
                        <>
                            <div
                                style={{ padding: '16px', lineHeight: '1.6', fontSize: '13px', color: 'var(--center-channel-color, #d0d0d0)', wordBreak: 'break-word' }}
                                dangerouslySetInnerHTML={{ __html: selectedEmail.content || '' }}
                            />
                            {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))', padding: '16px', backgroundColor: 'var(--center-channel-color-04, rgba(255,255,255,0.02))' }}>
                                    <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--center-channel-color)' }}>
                                        📎 Attachments ({selectedEmail.attachments.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {selectedEmail.attachments.map((att: any, idx: number) => {
                                            const sizeKB = att.fileSize ? `${(att.fileSize / 1024).toFixed(1)} KB` : '';
                                            const downloadUrl = `${apiBase()}/attachment?folderId=${meta?.folderId || ''}&messageId=${meta?.messageId || ''}&attachId=${att.attachmentId}`;
                                            return (
                                                <a
                                                    key={att.attachmentId || idx}
                                                    href={downloadUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        padding: '8px 10px',
                                                        borderRadius: '4px',
                                                        backgroundColor: 'var(--center-channel-color-08, rgba(255,255,255,0.04))',
                                                        color: '#2b7bea',
                                                        textDecoration: 'none',
                                                        fontSize: '12px',
                                                        border: '1px solid var(--center-channel-color-08, rgba(255,255,255,0.06))',
                                                    }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--center-channel-color-12, rgba(255,255,255,0.08))'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--center-channel-color-08, rgba(255,255,255,0.04))'; }}
                                                >
                                                    <span>📄</span>
                                                    <span style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                        {att.attachmentName || att.fileName || 'Unnamed Attachment'}
                                                    </span>
                                                    {sizeKB && (
                                                        <span style={{ color: 'var(--center-channel-color-56)', fontSize: '11px', marginRight: '6px' }}>
                                                            ({sizeKB})
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: '11px', textDecoration: 'underline' }}>Download</span>
                                                </a>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    }

    // ─── Inbox list view ───
    return (
        <div style={css.root}>
            {/* Toolbar */}
            <div style={css.toolbar}>
                <button
                    style={css.newMailBtn}
                    onClick={() => setComposing(true)}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(232,67,62,0.4)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(232,67,62,0.3)'; }}
                >
                    ✉ New Mail
                </button>
                <div style={css.toolbarRight}>
                    <button style={css.iconBtn} onClick={() => loadEmails()} title="Refresh">🔄</button>
                    <button style={css.disconnectBtn} onClick={handleDisconnect}>Disconnect</button>
                </div>
            </div>

            {/* Folder tabs */}
            <div style={css.folderBar}>
                {displayFolders.map((f) => (
                    <button
                        key={f.folderName}
                        style={css.folderTab(activeFolder.toLowerCase() === f.folderName.toLowerCase())}
                        onClick={() => handleFolderClick(f.folderName)}
                    >
                        <span>{getFolderIcon(f.folderName)}</span>
                        {f.folderName}
                        {f.unreadCount > 0 && (
                            <span style={css.folderBadge}>{f.unreadCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Loading indicator */}
            {loading && <div style={css.loadingBar} />}

            {/* Email list */}
            <div style={css.emailList}>
                {errorMsg && (
                    <div style={{padding: '12px 14px', color: '#e8433e', fontSize: '12px', fontWeight: '500'}}>
                        {errorMsg}
                    </div>
                )}

                {!loading && emails.length === 0 && !errorMsg ? (
                    <div style={{textAlign: 'center', color: 'var(--center-channel-color-56)', marginTop: '40px', fontSize: '13px'}}>
                        No emails in {activeFolder}.
                    </div>
                ) : (
                    emails.map((email) => {
                        const senderName = email.sender || email.fromAddress || '';
                        const color = getAccentColor(senderName);
                        const isUnread = email.status2 === 'unread' || !email.status2;
                        return (
                            <div
                                key={email.messageId}
                                style={css.emailRow(isUnread)}
                                onClick={() => loadEmailDetail(email)}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--center-channel-color-04, rgba(255,255,255,0.04))';
                                    e.currentTarget.style.borderLeftColor = color;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = isUnread ? 'var(--center-channel-color-04, rgba(43,123,234,0.04))' : 'transparent';
                                    e.currentTarget.style.borderLeftColor = 'transparent';
                                }}
                            >
                                <div style={css.avatar(color)}>{getInitials(senderName)}</div>
                                <div style={css.emailBody}>
                                    <div style={css.emailHeader}>
                                        <span style={css.emailSender(isUnread)}>{senderName}</span>
                                        <span style={css.emailDate}>{formatDate(email.receivedTime)}</span>
                                    </div>
                                    <div style={css.emailSubject(isUnread)}>{email.subject || '(No Subject)'}</div>
                                    <div style={css.emailSnippet}>{decodeHtml(email.summary || '')}</div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
