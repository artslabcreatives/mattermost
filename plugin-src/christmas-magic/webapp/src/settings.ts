export const PLUGIN_ID = 'com.custom.christmas-magic';
export const CONFIG_EVENT = `custom_${PLUGIN_ID}_configuration`;
export const WISH_EVENT = `custom_${PLUGIN_ID}_wish`;
export const WISHES_REMOVED_EVENT = `custom_${PLUGIN_ID}_wishes_removed`;

export interface Settings {
    Enabled: boolean;
    Snow: boolean;
    Santa: boolean;
    Gifts: boolean;
    Snowman: boolean;
    Sound: boolean;
    SnowDensity: number;
    SantaMinSeconds: number;
    SantaMaxSeconds: number;
    GiftGreetings: boolean;
    GiftMessages: string;
    JustKidding: boolean;
    Tree: boolean;
    Wishes: boolean;
    StartDate: string;
    EndDate: string;
}

// Must match defaultGiftMessages in server/main.go and the GiftMessages default in plugin.json.
export const DEFAULT_GIFT_MESSAGES = `You got a special leave day! 🏖️ | Enjoy your extra day off.
You got a half-day leave! 🕐 | You can leave at lunch today.
You got a salary increment! 💰 | It will show on your next payslip.
You have been promoted! 🚀 | Your new title starts on Monday.
You got a year-end bonus! 🎉 | Santa approved it personally.
You got work-from-home for a month! 🏠 | Pyjamas are the new dress code.
Free lunch on the company today! 🍕 | Order whatever you like.
You got an extra week of holidays! 🎄 | Your calendar is all yours.`;

export const defaults: Settings = {
    Enabled: true, Snow: true, Santa: true, Gifts: true, Snowman: true, Sound: true,
    SnowDensity: 60, SantaMinSeconds: 30, SantaMaxSeconds: 90,
    GiftGreetings: true, GiftMessages: DEFAULT_GIFT_MESSAGES, JustKidding: true, Tree: true, Wishes: true,
    StartDate: '', EndDate: '',
};

export interface Wish {id: string; name: string; message: string; create_at: number}

// "Headline | smaller line" per line; blank lines are skipped. An empty list falls back to the defaults.
export function parseGiftMessages(text: string): Array<[string, string]> {
    const parse = (value: string) => value.split('\n').map((line) => {
        const [headline, ...rest] = line.split('|');
        return [headline.trim().slice(0, 120), rest.join('|').trim().slice(0, 160)] as [string, string];
    }).filter(([headline]) => headline).slice(0, 100);
    const messages = parse(text);
    return messages.length ? messages : parse(DEFAULT_GIFT_MESSAGES);
}

function dateIsValid(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function inSeason(settings: Settings, now = new Date()): boolean {
    const {StartDate: start, EndDate: end} = settings;
    if ((start && !dateIsValid(start)) || (end && !dateIsValid(end)) || (start && end && start > end)) {
        return false;
    }
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return (!start || day >= start) && (!end || day <= end);
}

export function normalizeSettings(input: Partial<Settings>): Settings {
    const result = {...defaults};
    for (const key of ['Enabled', 'Snow', 'Santa', 'Gifts', 'Snowman', 'Sound', 'GiftGreetings', 'JustKidding', 'Tree', 'Wishes'] as const) {
        if (typeof input[key] === 'boolean') result[key] = input[key]!;
    }
    for (const key of ['StartDate', 'EndDate'] as const) {
        if (typeof input[key] === 'string') result[key] = input[key]!.trim();
    }
    if (typeof input.GiftMessages === 'string') result.GiftMessages = input.GiftMessages;
    const clamp = (value: unknown, fallback: number, min: number, max: number) =>
        typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;
    result.SnowDensity = clamp(input.SnowDensity, 60, 0, 150);
    result.SantaMinSeconds = clamp(input.SantaMinSeconds, 30, 30, 3600);
    result.SantaMaxSeconds = clamp(input.SantaMaxSeconds, 90, result.SantaMinSeconds, 3600);
    return result;
}

export function preferenceKey(userId: string): string {
    return `${PLUGIN_ID}:${userId}:enabled`;
}

export function soundKey(userId: string): string {
    return `${PLUGIN_ID}:${userId}:sound`;
}
