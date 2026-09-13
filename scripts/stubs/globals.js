import process from 'node:process';
import { Buffer } from 'node:buffer';

if (typeof globalThis.process === 'undefined') {
  globalThis.process = process;
}

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
