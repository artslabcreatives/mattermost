import React, { useState, useEffect } from 'react';
import manifest from './manifest';
import { PollPost } from './components/poll_post/poll_post';
import { CreatePollModal } from './components/create_poll_modal/create_poll_modal';

let openModalCallback: ((channelId: string) => void) | null = null;

const RootComponent: React.FC<{ store: any }> = ({ store }) => {
    const [visible, setVisible] = useState(false);
    const [channelId, setChannelId] = useState('');

    useEffect(() => {
        openModalCallback = (cId: string) => {
            setChannelId(cId);
            setVisible(true);
        };
        return () => {
            openModalCallback = null;
        };
    }, []);

    return (
        <CreatePollModal
            visible={visible}
            channelId={channelId}
            onClose={() => setVisible(false)}
        />
    );
};

class Plugin {
    public initialize(registry: any, store: any) {
        // Register custom post type component for WhatsApp Polls
        registry.registerPostTypeComponent('custom_poll', (props: any) => {
            const state = store.getState();
            const currentUserId = state?.entities?.users?.currentUserId || '';
            return <PollPost {...props} currentUserId={currentUserId} />;
        });

        // Register Root Component for CreatePollModal
        registry.registerRootComponent(() => <RootComponent store={store} />);

        // Register WebSocket listener to open custom React CreatePollModal
        if (registry.registerWebSocketEventHandler) {
            registry.registerWebSocketEventHandler(
                'custom_' + manifest.id + '_open_create_poll_modal',
                (ev: any) => {
                    const channelId = ev?.data?.channel_id || store.getState()?.entities?.channels?.currentChannelId || '';
                    if (openModalCallback) {
                        openModalCallback(channelId);
                    }
                }
            );
        }

        // Also intercept slash command if executed client side
        if (registry.registerSlashCommandWillBeExecutedHook) {
            registry.registerSlashCommandWillBeExecutedHook((message: string, args: any) => {
                const trimmed = message.trim();
                if (trimmed === '/poll' || trimmed.startsWith('/poll ')) {
                    const currentChannelId = args?.channel_id || store.getState()?.entities?.channels?.currentChannelId || '';
                    if (openModalCallback) {
                        openModalCallback(currentChannelId);
                    }
                    return Promise.resolve({ message: '', args });
                }
                return Promise.resolve({ message, args });
            });
        }
    }
}

declare global {
    interface Window {
        registerPlugin(id: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
