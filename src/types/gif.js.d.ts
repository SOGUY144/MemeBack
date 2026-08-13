declare module 'gif.js' {
  interface GIFOptions {
    workers?: number;
    quality?: number;
    dither?: boolean | string;
    width?: number;
    height?: number;
    workerScript?: string;
    repeat?: number;
    background?: string;
    transparent?: string | null;
    debug?: boolean;
  }

  interface FrameOptions {
    delay?: number;
    copy?: boolean;
    dispose?: number;
  }

  export default class GIF {
    constructor(options?: GIFOptions);
    addFrame(
      image: CanvasImageSource | CanvasRenderingContext2D | ImageData,
      options?: FrameOptions,
    ): void;
    render(): void;
    abort(): void;
    on(event: 'finished', cb: (blob: Blob) => void): void;
    on(event: 'progress', cb: (progress: number) => void): void;
    on(event: 'abort' | 'start', cb: () => void): void;
  }
}
