declare module '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs' {
  interface FrameInfo {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
  }
  interface Decoder {
    getEncodedBuffer(length: number): Uint8Array;
    readHeader(): void;
    getFrameInfo(): FrameInfo;
    decode(): void;
    getDecodedBuffer(): Uint8Array;
    delete(): void;
  }
  interface DecoderModule {
    JPEGDecoder: new () => Decoder;
  }
  export default function initialize(options: {
    wasmBinary: Uint8Array;
    print: (...data: unknown[]) => void;
    printErr: (...data: unknown[]) => void;
  }): Promise<DecoderModule>;
}
