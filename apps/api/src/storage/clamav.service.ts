import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';

export interface ScanResult {
  clean: boolean;
  signature?: string;
}

/**
 * Minimal clamd client over TCP INSTREAM (Spec §5.6, §12) — no third-party dep.
 * Streams bytes to ClamAV in length-prefixed chunks and parses the verdict.
 */
@Injectable()
export class ClamavService {
  private readonly logger = new Logger(ClamavService.name);
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST', 'localhost');
    this.port = config.get<number>('CLAMAV_PORT', 3310);
  }

  /** PING/PONG liveness check. */
  ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(3000);
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
      socket.connect(this.port, this.host, () => socket.write('zPING\0'));
      socket.on('data', (d) => done(d.toString().includes('PONG')));
    });
  }

  /** Scan a readable stream via INSTREAM. Resolves with the verdict. */
  scanStream(input: NodeJS.ReadableStream): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let response = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };

      socket.setTimeout(120_000);
      socket.on('timeout', () => finish(() => reject(new Error('clamd scan timed out'))));
      socket.on('error', (err) => finish(() => reject(err)));
      socket.on('data', (d) => {
        response += d.toString();
      });
      socket.on('close', () => {
        if (settled) return;
        settled = true;
        // clamd terminates replies with a NUL byte; strip it before parsing.
        const text = response.replace(/\0/g, '').trim();
        const found = text.match(/:\s*(.+?)\s+FOUND$/);
        if (found) return resolve({ clean: false, signature: found[1] });
        if (/\bOK$/.test(text)) return resolve({ clean: true });
        reject(new Error(`Unexpected clamd response: ${text || '(empty)'}`));
      });

      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        input.on('data', (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(buf.length, 0);
          socket.write(size);
          socket.write(buf);
        });
        input.on('end', () => {
          const terminator = Buffer.alloc(4); // zero-length chunk ends the stream
          socket.write(terminator);
        });
        input.on('error', (err) => finish(() => reject(err)));
      });
    });
  }
}
