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

const TOOLTIP = 'Trustvault';

const iconUrl = () => `${(window as any).basename || ''}/plugins/${manifest.id}/public/icon.svg`;

class TrustvaultPlugin {
    initialize(registry: PluginRegistry, store: any) {
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
        registerPlugin(pluginId: string, plugin: TrustvaultPlugin): void;
    }
}

window.registerPlugin(manifest.id, new TrustvaultPlugin());
