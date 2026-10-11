/** Messages between main thread and detector.worker. */

/** Detection in crop space: centre/size normalised to the S x S center-square crop. */
export interface CropDet {
  cls: number;
  conf: number;
  box: [cx: number, cy: number, w: number, h: number];
}

export interface ModelMeta {
  imgsz: number;
  arch?: string;
  output: 'end2end' | 'raw';
  outputShape?: number[];
  classes: string[];
  input: string;
  outputName: string;
}

export type ToWorker =
  | { type: 'init'; name: string; ep: 'auto' | 'webgpu' | 'wasm' }
  | { type: 'frame'; seq: number; bitmap: ImageBitmap };

export type FromWorker =
  | { type: 'ready'; backend: string; imgsz: number; classes: string[]; loadMs: number }
  | { type: 'error'; message: string; missing: boolean }
  | { type: 'result'; seq: number; dets: CropDet[]; inferMs: number; backend: string };
