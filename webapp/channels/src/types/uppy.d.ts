// Type shims for Uppy v5 packages.
// These declarations allow the Uppy packages to be imported in the
// channels workspace which uses moduleResolution: "node".
// The actual runtime resolution is handled by webpack.

declare module '@uppy/core' {
    export interface Restrictions {
        maxFileSize?: number | null;
        minFileSize?: number | null;
        maxTotalFileSize?: number | null;
        maxNumberOfFiles?: number | null;
        minNumberOfFiles?: number | null;
        allowedFileTypes?: string[] | null;
        requiredMetaFields?: string[];
    }

    export interface UppyOptions {
        id?: string;
        autoProceed?: boolean;
        allowMultipleUploadBatches?: boolean;
        logger?: {
            debug: (...args: any[]) => void;
            warn: (...args: any[]) => void;
            error: (...args: any[]) => void;
        };
        restrictions?: Restrictions;
        meta?: Record<string, unknown>;
        onBeforeFileAdded?: (file: UppyFile, files: {[id: string]: UppyFile}) => UppyFile | boolean | undefined;
        onBeforeUpload?: (files: {[id: string]: UppyFile}) => {[id: string]: UppyFile} | boolean;
    }

    export interface UppyFile {
        id: string;
        name?: string;
        type?: string;
        size?: number;
        data: Blob | File;
        meta: Record<string, unknown>;
        source?: string;
        isRemote?: boolean;
        error?: string;
    }

    export interface UploadResult {
        successful: UppyFile[];
        failed: UppyFile[];
    }

    export interface PluginOptions {
        id?: string;
    }

    export type UploadHandler = (fileIDs: string[]) => Promise<void>;

    export default class Uppy {
        constructor(opts?: UppyOptions);
        use<T extends PluginOptions>(plugin: new (uppy: Uppy, opts?: T) => unknown, opts?: T): this;
        upload(): Promise<UploadResult>;
        addFile(file: Partial<UppyFile> & { name: string; data: Blob | File }): string;
        removeFile(fileID: string): void;
        getFiles(): UppyFile[];
        destroy(): void;
        on(event: string, handler: (...args: any[]) => void): this;
        off(event: string, handler: (...args: any[]) => void): this;
        setMeta(data: Record<string, unknown>): void;
        reset(): void;
    }
}

declare module '@uppy/aws-s3' {
    import type Uppy from '@uppy/core';
    import type { UppyFile, PluginOptions } from '@uppy/core';

    export interface AwsS3UploadParameters {
        method: 'PUT' | 'POST';
        url: string;
        fields?: Record<string, string>;
        headers?: Record<string, string>;
    }

    export interface AwsS3Options extends PluginOptions {
        shouldUseMultipart?: boolean | ((file: UppyFile) => boolean);
        getUploadParameters?: (file: UppyFile) => Promise<AwsS3UploadParameters> | AwsS3UploadParameters;
        companionUrl?: string;
        limit?: number;
    }

    export default class AwsS3 {
        constructor(uppy: Uppy, opts?: AwsS3Options);
    }
}

declare module '@uppy/dashboard' {
    import type Uppy from '@uppy/core';
    import type { PluginOptions } from '@uppy/core';

    export interface DashboardOptions extends PluginOptions {
        inline?: boolean;
        target?: string | Element;
        trigger?: string | Element;
        width?: number | string;
        height?: number | string;
        thumbnailWidth?: number;
        theme?: 'auto' | 'dark' | 'light';
        showProgressDetails?: boolean;
        hideUploadButton?: boolean;
        hideCancelButton?: boolean;
        hideRetryButton?: boolean;
        hidePauseResumeButton?: boolean;
        showRemoveButtonAfterComplete?: boolean;
        fileManagerSelectionType?: 'files' | 'folders' | 'both';
        plugins?: string[];
        locale?: Record<string, unknown>;
        metaFields?: Array<{id: string; name: string; placeholder?: string}>;
        closeModalOnClickOutside?: boolean;
        disablePageScrollWhenModalOpen?: boolean;
        proudlyDisplayPoweredByUppy?: boolean;
        note?: string;
        browserBackButtonClose?: boolean;
        autoOpenFileEditor?: boolean;
        animateOpenClose?: boolean;
        singleFileFullScreen?: boolean;
    }

    export default class Dashboard {
        constructor(uppy: Uppy, opts?: DashboardOptions);
    }
}

declare module '@uppy/google-drive' {
    import type Uppy from '@uppy/core';
    import type { PluginOptions } from '@uppy/core';

    export interface GoogleDriveOptions extends PluginOptions {
        companionUrl: string;
        companionHeaders?: Record<string, string>;
        companionCookiesRule?: string;
    }

    export default class GoogleDrive {
        constructor(uppy: Uppy, opts?: GoogleDriveOptions);
    }
}

declare module '@uppy/dropbox' {
    import type Uppy from '@uppy/core';
    import type { PluginOptions } from '@uppy/core';

    export interface DropboxOptions extends PluginOptions {
        companionUrl: string;
        companionHeaders?: Record<string, string>;
        companionCookiesRule?: string;
    }

    export default class Dropbox {
        constructor(uppy: Uppy, opts?: DropboxOptions);
    }
}

declare module '@uppy/companion-client' {
    export interface CompanionClientOptions {
        companionUrl: string;
        companionHeaders?: Record<string, string>;
        companionCookiesRule?: 'include' | 'same-origin' | 'omit';
    }
}
