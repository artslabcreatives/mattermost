import React from 'react';
import RHS from './components/rhs';

import manifest from '../../plugin.json';

interface AppBarArgs {
    iconUrl: string;
    tooltipText: string;
    supportedProductIds: string[] | null;
    rhsComponent: unknown;
    rhsTitle: unknown;
}

interface PluginRegistry {
    registerAppBarComponent?: (args: AppBarArgs) => unknown;
    registerRightHandSidebarComponent: (component: unknown, title: unknown) => {showRHSPlugin: unknown; toggleRHSPlugin: unknown};
    registerChannelHeaderButtonAction: (icon: unknown, action: unknown, dropdownText: string, tooltipText: string) => unknown;
}

const TOOLTIP = 'Aura';

const apiBase = () => `${(window as any).basename || ''}/plugins/${manifest.id}/api/v1`;
const iconUrl = () => `${(window as any).basename || ''}/plugins/${manifest.id}/public/icon.png`;

class AuraPlugin {
    async initialize(registry: PluginRegistry, store: any) {
        try {
            const resp = await fetch(`${apiBase()}/check-access`, {
                credentials: 'include',
                headers: {'X-Requested-With': 'XMLHttpRequest'},
            });
            if (resp.ok) {
                const data = await resp.json();
                if (!data || !data.allowed) {
                    // User is not allowed to see or access Aura
                    return;
                }
            }
        } catch (err) {
            // Fail safe: if check fails, do not register
            return;
        }

        if (registry.registerAppBarComponent) {
            registry.registerAppBarComponent({
                iconUrl: iconUrl(),
                tooltipText: TOOLTIP,
                supportedProductIds: null,
                rhsComponent: RHS,
                rhsTitle: TOOLTIP,
            });
            return;
        }

        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(RHS, TOOLTIP);
        registry.registerChannelHeaderButtonAction(
            <img
                src={iconUrl()}
                width={16}
                height={16}
                alt=''
            />,
            () => store.dispatch(toggleRHSPlugin),
            TOOLTIP,
            TOOLTIP,
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: AuraPlugin): void;
    }
}

window.registerPlugin(manifest.id, new AuraPlugin());
