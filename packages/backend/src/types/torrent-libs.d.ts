/**
 * Minimal ambient declarations for the ESM-only torrent libraries we use.
 * We declare only the subset of the API surface Flux actually touches, verified
 * against the current READMEs (webtorrent v3, parse-torrent v11). This avoids
 * depending on possibly-stale @types packages.
 */

declare module 'webtorrent' {
  interface TorrentFile {
    name: string;
    /** Full path of the file within the torrent (relative to the torrent root). */
    path: string;
    length: number;
  }

  interface Torrent {
    readonly infoHash: string;
    readonly name: string;
    readonly length: number;
    readonly files: TorrentFile[];
    /** Absolute path the torrent's files are stored under (the `path` opt). */
    readonly path: string;
    readonly progress: number; // 0..1
    readonly downloadSpeed: number; // bytes/s
    readonly uploadSpeed: number; // bytes/s
    readonly downloaded: number;
    readonly uploaded: number;
    readonly numPeers: number;
    readonly ratio: number;
    readonly timeRemaining: number; // ms
    readonly done: boolean;
    readonly paused: boolean;

    on(event: 'done', listener: () => void): this;
    on(event: 'error', listener: (err: Error | string) => void): this;
    on(event: 'ready', listener: () => void): this;
    on(event: 'metadata', listener: () => void): this;
    on(event: 'download', listener: (bytes: number) => void): this;
    on(event: 'upload', listener: (bytes: number) => void): this;
    on(event: 'noPeers', listener: (announceType: string) => void): this;
    on(event: 'warning', listener: (err: Error | string) => void): this;
    once(event: 'done', listener: () => void): this;
    once(event: 'error', listener: (err: Error | string) => void): this;

    pause(): void;
    resume(): void;
    destroy(
      opts?: { destroyStore?: boolean },
      cb?: (err?: Error) => void,
    ): void;
  }

  interface AddTorrentOptions {
    /** Folder to download files to. */
    path?: string;
    /** Do not verify/announce; useful for seeding existing files. */
    [key: string]: unknown;
  }

  export default class WebTorrent {
    constructor(opts?: Record<string, unknown>);
    readonly torrents: Torrent[];
    add(
      torrentId: Buffer | Uint8Array | string,
      opts?: AddTorrentOptions,
      onTorrent?: (torrent: Torrent) => void,
    ): Torrent;
    get(
      torrentId: string,
    ): Torrent | null | undefined | Promise<Torrent | null | undefined>;
    remove(
      torrentId: string,
      opts?: { destroyStore?: boolean },
      cb?: (err?: Error) => void,
    ): void;
    destroy(cb?: (err?: Error) => void): void;
    on(event: 'error', listener: (err: Error | string) => void): this;
    on(event: 'torrent', listener: (torrent: Torrent) => void): this;
  }
}

declare module 'parse-torrent' {
  interface ParsedTorrentFile {
    name: string;
    path: string;
    length: number;
    offset: number;
  }
  interface ParsedTorrent {
    infoHash: string;
    name?: string;
    length?: number;
    files?: ParsedTorrentFile[];
    announce?: string[];
    created?: Date;
    comment?: string;
  }
  /**
   * For a Buffer/Uint8Array of a .torrent file this resolves synchronously in
   * practice, but we always `await` it to be safe across versions.
   */
  export default function parseTorrent(
    input: Buffer | Uint8Array,
  ): Promise<ParsedTorrent> | ParsedTorrent;
}
