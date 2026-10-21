declare module 'troika-three-text' {
  import { Mesh } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | undefined;
    fontSize: number;
    maxWidth: number;
    anchorX: 'left' | 'center' | 'right' | number;
    anchorY: 'top' | 'middle' | 'bottom' | number;
    textAlign: 'left' | 'center' | 'right' | 'justify';
    color: number | string;
    lineHeight: number;
    letterSpacing: number;
    outlineWidth: number | string;
    outlineColor: number | string;
    sync(cb?: () => void): void;
    dispose(): void;
  }
}
