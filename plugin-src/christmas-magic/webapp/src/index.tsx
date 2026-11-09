import React from 'react';

import WishesAdmin from './admin';
import App, {FallbackSwitch, MenuLabel} from './app';
import {SnowIcon} from './artwork';
import {CONFIG_EVENT, Controller, type Store} from './controller';
import {PLUGIN_ID, WISH_EVENT, WISHES_REMOVED_EVENT, type Settings, type Wish} from './settings';

interface Registry {
    registerRootComponent(component: React.ComponentType): string;
    registerChannelHeaderIcon?(component: React.ComponentType): string;
    registerChannelHeaderButtonAction(icon: React.ReactNode, action: () => void, dropdownText: string, tooltipText: string): string;
    registerMainMenuAction(text: React.ReactNode, action: () => void, mobileIcon: React.ReactNode): string;
    registerWebSocketEventHandler(event: string, handler: (event: {data: {settings: Settings; wish: Wish; id: string}}) => void): void;
    registerAdminConsoleCustomSetting?(key: string, component: React.ComponentType, options?: {showTitle: boolean}): void;
    unregisterWebSocketEventHandler(event: string): void;
    registerReconnectHandler(handler: () => void): void;
    unregisterReconnectHandler(): void;
    unregisterComponent(id: string): void;
}

class ChristmasMagicPlugin {
    private controller?: Controller;
    private registry?: Registry;
    private components: string[] = [];

    initialize(registry: Registry, store: Store) {
        this.uninitialize();
        this.registry = registry;
        const controller = new Controller(store);
        this.controller = controller;
        registry.registerWebSocketEventHandler(CONFIG_EVENT, (event) => controller.receive(event.data.settings));
        registry.registerWebSocketEventHandler(WISH_EVENT, (event) => controller.receiveWish(event.data.wish));
        registry.registerWebSocketEventHandler(WISHES_REMOVED_EVENT, (event) => controller.removeWishes(event.data.id));
        registry.registerAdminConsoleCustomSetting?.('WishesList', () => <WishesAdmin controller={controller}/>, {showTitle: true});
        registry.registerReconnectHandler(controller.refresh);
        controller.start();
        this.components.push(registry.registerRootComponent(() => <App controller={controller}/>));
        this.components.push(registry.registerMainMenuAction(<MenuLabel controller={controller}/>, controller.toggle, <SnowIcon/>));
        if (registry.registerChannelHeaderIcon) {
            this.components.push(registry.registerChannelHeaderIcon(() => <FallbackSwitch controller={controller}/>));
        } else {
            this.components.push(registry.registerChannelHeaderButtonAction(<SnowIcon/>, controller.toggle, 'Toggle Christmas animations', 'Toggle Christmas animations'));
        }
    }

    uninitialize() {
        this.controller?.stop();
        this.components.forEach((id) => this.registry?.unregisterComponent(id));
        this.registry?.unregisterWebSocketEventHandler(CONFIG_EVENT);
        this.registry?.unregisterWebSocketEventHandler(WISH_EVENT);
        this.registry?.unregisterWebSocketEventHandler(WISHES_REMOVED_EVENT);
        this.registry?.unregisterReconnectHandler();
        this.components = [];
        this.controller = undefined;
        this.registry = undefined;
    }
}

declare global {interface Window {registerPlugin(id: string, plugin: ChristmasMagicPlugin): void}}
window.registerPlugin(PLUGIN_ID, new ChristmasMagicPlugin());
