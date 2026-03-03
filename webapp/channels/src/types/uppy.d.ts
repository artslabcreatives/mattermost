// Type shims for Uppy v5 packages.
// These declarations allow the Uppy packages to be imported in the
// channels workspace which uses moduleResolution: "node".
// The actual runtime resolution is handled by webpack.
// Auto-generated — do not edit by hand.

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
		onBeforeFileAdded?: (file: UppyFile, files: { [id: string]: UppyFile }) => UppyFile | boolean | undefined;
		onBeforeUpload?: (files: { [id: string]: UppyFile }) => { [id: string]: UppyFile } | boolean;
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
		/** True when the file was restored from IndexedDB by @uppy/golden-retriever. */
		isRestored?: boolean;
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
		setFileMeta(fileID: string, data: Record<string, unknown>): void;
		reset(): void;
		clear(): void;
		cancelAll(): void;
		pauseAll(): void;
		resumeAll(): void;
		retryAll(): Promise<UploadResult>;
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
		metaFields?: Array<{ id: string; name: string; placeholder?: string }>;
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

declare module '@uppy/tus' {
	import type Uppy from '@uppy/core';
	import type { UppyFile, PluginOptions } from '@uppy/core';

	export interface TusOptions extends PluginOptions {
		endpoint: string;
		headers?: Record<string, string> | ((file: UppyFile) => Record<string, string>);
		chunkSize?: number;
		retryDelays?: number[] | null;
		limit?: number;
		withCredentials?: boolean;
		onBeforeRequest?: (req: unknown, file: UppyFile) => void | Promise<void>;
		onAfterResponse?: (req: unknown, res: unknown) => void | Promise<void>;
		onShouldRetry?: (err: unknown, retryAttempt: number, options: TusOptions, next: () => void) => boolean;
		removeFingerprintOnSuccess?: boolean;
		allowedMetaFields?: string[] | null;
		fieldName?: string;
	}

	export default class Tus {
		constructor(uppy: Uppy, opts?: TusOptions);
	}
}

declare module '@uppy/golden-retriever' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface GoldenRetrieverOptions extends PluginOptions {
		serviceWorker?: boolean;
		indexedDB?: {
			maxFileSize?: number;
			maxTotalSize?: number;
		};
	}

	export default class GoldenRetriever {
		constructor(uppy: Uppy, opts?: GoldenRetrieverOptions);
	}
}

declare module '@uppy/webcam' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface WebcamOptions extends PluginOptions {
		target?: string | Element | typeof import('@uppy/dashboard').default;
		modes?: Array<'video-audio' | 'video-only' | 'audio-only' | 'picture'>;
		mirror?: boolean;
		facingMode?: 'user' | 'environment' | 'left' | 'right';
		videoConstraints?: MediaTrackConstraints;
		showVideoSourceDropdown?: boolean;
		title?: string;
	}

	export default class Webcam {
		constructor(uppy: Uppy, opts?: WebcamOptions);
	}
}

declare module '@uppy/audio' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface AudioOptions extends PluginOptions {
		target?: string | Element | typeof import('@uppy/dashboard').default;
		showAudioSourceDropdown?: boolean;
		title?: string;
	}

	export default class Audio {
		constructor(uppy: Uppy, opts?: AudioOptions);
	}
}

declare module '@uppy/screen-capture' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface ScreenCaptureOptions extends PluginOptions {
		target?: string | Element | typeof import('@uppy/dashboard').default;
		displayMediaConstraints?: DisplayMediaStreamConstraints;
		userMediaConstraints?: MediaStreamConstraints;
		title?: string;
	}

	export default class ScreenCapture {
		constructor(uppy: Uppy, opts?: ScreenCaptureOptions);
	}
}

declare module '@uppy/url' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface UrlOptions extends PluginOptions {
		companionUrl: string;
		companionHeaders?: Record<string, string>;
		companionCookiesRule?: string;
		target?: string | Element | typeof import('@uppy/dashboard').default;
		title?: string;
	}

	export default class Url {
		constructor(uppy: Uppy, opts?: UrlOptions);
	}
}

declare module '@uppy/onedrive' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface OneDriveOptions extends PluginOptions {
		companionUrl: string;
		companionHeaders?: Record<string, string>;
		companionCookiesRule?: string;
		target?: string | Element | typeof import('@uppy/dashboard').default;
		title?: string;
	}

	export default class OneDrive {
		constructor(uppy: Uppy, opts?: OneDriveOptions);
	}
}

declare module '@uppy/box' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface BoxOptions extends PluginOptions {
		companionUrl: string;
		companionHeaders?: Record<string, string>;
		companionCookiesRule?: string;
		target?: string | Element | typeof import('@uppy/dashboard').default;
		title?: string;
	}

	export default class Box {
		constructor(uppy: Uppy, opts?: BoxOptions);
	}
}

declare module '@uppy/unsplash' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface UnsplashOptions extends PluginOptions {
		companionUrl: string;
		companionHeaders?: Record<string, string>;
		companionCookiesRule?: string;
		target?: string | Element | typeof import('@uppy/dashboard').default;
		title?: string;
	}

	export default class Unsplash {
		constructor(uppy: Uppy, opts?: UnsplashOptions);
	}
}

declare module '@uppy/image-editor' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface ImageEditorOptions extends PluginOptions {
		target?: string | Element | typeof import('@uppy/dashboard').default;
		quality?: number;
		cropperOptions?: Record<string, unknown>;
		actions?: {
			revert?: boolean;
			rotate?: boolean;
			granularRotate?: boolean;
			flip?: boolean;
			zoomIn?: boolean;
			zoomOut?: boolean;
			cropSquare?: boolean;
			cropWidescreen?: boolean;
			cropWidescreenVertical?: boolean;
		};
	}

	export default class ImageEditor {
		constructor(uppy: Uppy, opts?: ImageEditorOptions);
	}
}

declare module '@uppy/drop-target' {
	import type Uppy from '@uppy/core';
	import type { PluginOptions } from '@uppy/core';

	export interface DropTargetOptions extends PluginOptions {
		target: string | Element;
		onDragOver?: (event: DragEvent) => void;
		onDragLeave?: (event: DragEvent) => void;
		onDrop?: (event: DragEvent) => void;
	}

	export default class DropTarget {
		constructor(uppy: Uppy, opts?: DropTargetOptions);
	}
}
