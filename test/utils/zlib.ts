import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

export const inflateAsync = promisify(inflate);
