import {CONFIG_EVENT, PLUGIN_ID, defaults, inSeason, normalizeSettings, preferenceKey, soundKey, type Settings, type Wish} from './settings';

export interface Store {
    getState(): {entities: {users: {currentUserId: string; profiles?: Record<string, {first_name?: string; nickname?: string; username?: string}>}; general: {config: {SiteURL?: string}}}};
    subscribe(listener: () => void): () => void;
}

export interface Snapshot {
    settings: Settings;
    userId: string;
    name: string;
    checked: boolean;
    active: boolean;
    reason: string;
    soundPreferred: boolean; // The user's own speaker button.
    sound: boolean; // Whether Santa's sound should actually play.
    soundUrl: string;
    wishes: Wish[]; // Saved wishes, oldest first.
    newWish: Wish | null; // The latest wish received live, shown before the saved ones.
}

export class Controller {
    private settings: Settings = {...defaults, Enabled: false};
    private loaded = false;
    private preferred = true;
    private soundPreferred = true;
    private userId = '';
    private name = '';
    private wishes: Wish[] = [];
    private newWish: Wish | null = null;
    private listeners = new Set<() => void>();
    private cleanups: Array<() => void> = [];
    private midnight = 0;
    private request?: AbortController;
    private revision = 0;
    private stopped = false;
    private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    snapshot: Snapshot = {settings: this.settings, userId: '', name: '', checked: false, active: false, reason: 'Loading Christmas settings', soundPreferred: true, sound: false, soundUrl: '', wishes: [], newWish: null};

    constructor(private store: Store) {}

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {this.listeners.delete(listener);};
    };

    private publish = () => {
        if (this.stopped) return;
        const reason = !this.loaded ? 'Christmas settings are unavailable' :
            !this.settings.Enabled ? 'Christmas animations are disabled by your administrator' :
                !inSeason(this.settings) ? 'Christmas animations are outside the configured dates' :
                    this.motion.matches ? 'Christmas animations are off because you prefer reduced motion' : '';
        const checked = Boolean(this.userId && this.preferred && !reason);
        const active = checked && !document.hidden;
        this.snapshot = {
            settings: this.settings, userId: this.userId, name: this.name, checked, active, reason,
            soundPreferred: this.soundPreferred, sound: active && this.settings.Santa && this.settings.Sound && this.soundPreferred,
            soundUrl: `${this.base()}/plugins/${PLUGIN_ID}/public/santa.wav`,
            wishes: this.wishes, newWish: this.newWish,
        };
        this.listeners.forEach((listener) => listener());
    };

    private readPreference = () => {
        try {this.preferred = localStorage.getItem(preferenceKey(this.userId)) !== 'false';} catch {this.preferred = true;}
        try {this.soundPreferred = localStorage.getItem(soundKey(this.userId)) !== 'false';} catch {this.soundPreferred = true;}
    };

    private onStore = () => {
        const {currentUserId, profiles} = this.store.getState().entities.users;
        const id = currentUserId || '';
        const profile = profiles?.[id];
        const name = profile?.first_name || profile?.nickname || profile?.username || '';
        if (id === this.userId) {
            if (name !== this.name) {this.name = name; this.publish();}
            return;
        }
        this.userId = id;
        this.name = name;
        this.readPreference();
        this.loaded = false;
        this.publish();
        void this.refresh();
    };

    start() {
        this.cleanups.push(this.store.subscribe(this.onStore));
        this.motion.addEventListener('change', this.publish);
        document.addEventListener('visibilitychange', this.publish);
        const storage = (event: StorageEvent) => {
            if (event.key === preferenceKey(this.userId) || event.key === soundKey(this.userId) || event.key === null) {this.readPreference(); this.publish();}
        };
        window.addEventListener('storage', storage);
        this.cleanups.push(() => {
            this.motion.removeEventListener('change', this.publish);
            document.removeEventListener('visibilitychange', this.publish);
            window.removeEventListener('storage', storage);
        });
        const scheduleMidnight = () => {
            this.publish();
            const next = new Date();
            next.setHours(24, 0, 0, 0);
            this.midnight = window.setTimeout(scheduleMidnight, next.getTime() - Date.now() + 50);
        };
        scheduleMidnight();
        this.onStore();
    }

    refresh = async () => {
        this.request?.abort();
        if (!this.userId || this.stopped) return;
        const request = new AbortController();
        this.request = request;
        const revision = ++this.revision;
        try {
            const response = await fetch(`${this.base()}/plugins/${PLUGIN_ID}/configuration`, {credentials: 'same-origin', signal: request.signal});
            if (!response.ok) throw new Error('Configuration unavailable');
            const settings = await response.json();
            if (!request.signal.aborted && !this.stopped && revision === this.revision) this.receive(settings);
            void this.reloadWishes(request.signal);
        } catch {
            if (!request.signal.aborted && !this.stopped && revision === this.revision) {this.loaded = false; this.publish();}
        }
    };

    receive = (settings: Partial<Settings>) => {
        if (this.stopped || !settings || typeof settings !== 'object') return;
        this.revision++;
        this.settings = normalizeSettings(settings);
        this.loaded = true;
        this.publish();
    };

    // Requests to this plugin's server API; adds the CSRF token Mattermost requires for changes.
    api = (path: string, init: RequestInit = {}) => {
        const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('MMCSRF='))?.slice('MMCSRF='.length);
        const headers = {'X-Requested-With': 'XMLHttpRequest', ...(csrf ? {'X-CSRF-Token': decodeURIComponent(csrf)} : {})};
        return fetch(`${this.base()}/plugins/${PLUGIN_ID}${path}`, {credentials: 'same-origin', ...init, headers: {...headers, ...init.headers}});
    };

    reloadWishes = async (signal?: AbortSignal) => {
        try {
            const response = await this.api('/wishes', {signal});
            const wishes = response.ok ? await response.json() : null;
            if (Array.isArray(wishes) && !this.stopped) {this.wishes = wishes; this.publish();}
        } catch { /* The tree simply shows no saved wishes. */ }
    };

    receiveWish = (wish: Wish) => {
        if (this.stopped || !wish?.id || this.wishes.some(({id}) => id === wish.id)) return;
        this.wishes = [...this.wishes, wish];
        this.newWish = wish;
        this.publish();
    };

    // An empty id means every wish was removed.
    removeWishes = (id: string) => {
        if (this.stopped) return;
        this.wishes = id ? this.wishes.filter((wish) => wish.id !== id) : [];
        if (!id || this.newWish?.id === id) this.newWish = null;
        this.publish();
    };

    // Path prefix for a Mattermost served under a subpath (e.g. /collab).
    private base() {
        const siteURL = this.store.getState().entities.general.config.SiteURL || window.location.origin;
        return new URL(siteURL, window.location.origin).pathname.replace(/\/$/, '');
    }

    toggleSound = () => {
        if (!this.snapshot.checked || !this.settings.Sound) return;
        this.soundPreferred = !this.soundPreferred;
        try {localStorage.setItem(soundKey(this.userId), String(this.soundPreferred));} catch { /* Works for this session when storage is blocked. */ }
        this.publish();
    };

    toggle = () => {
        if (this.snapshot.reason || !this.userId) return;
        this.preferred = !this.preferred;
        try {localStorage.setItem(preferenceKey(this.userId), String(this.preferred));} catch { /* Works for this session when storage is blocked. */ }
        this.publish();
    };

    stop() {
        this.stopped = true;
        this.request?.abort();
        clearTimeout(this.midnight);
        this.cleanups.forEach((cleanup) => cleanup());
        this.listeners.clear();
    }
}

export {CONFIG_EVENT};
