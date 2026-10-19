import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { FP_EMPTY } from './license-crypto.js';

const h = (tag: string, v: string) => createHash('sha256').update(`${tag}|${v}`).digest('hex').slice(0, 32);

function machineId(env: NodeJS.ProcessEnv): string {
  if (env.HOST_MACHINE_ID) return env.HOST_MACHINE_ID.trim();
  for (const p of ['/etc/host-machine-id', '/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      if (existsSync(p)) {
        const v = readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * اثرانگشت میزبان — ۵ مؤلفه‌ی هش‌شده (هیچ مقدار خام خارج نمی‌شود):
 *  0 machine-id میزبان (در docker با mount فقط‌خواندنی /etc/machine-id)  1 CPU  2 نسخه‌ی کرنل  3 کلاس RAM  4 MAC+hostname
 * ترتیب ثابت است؛ مقایسه‌ی تحمل‌پذیر در fingerprintMatches.
 */
export function computeFingerprintComponents(env: NodeJS.ProcessEnv = process.env): string[] {
  const mid = machineId(env);
  const cpus = os.cpus();
  const nets = Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((i) => !i.internal && i.mac && i.mac !== '00:00:00:00:00:00').map((i) => `${name}=${i.mac}`))
    .sort();
  return [
    mid ? h('mid', mid) : FP_EMPTY,
    h('cpu', `${cpus[0]?.model ?? ''}|${cpus.length}|${os.arch()}`),
    h('kernel', `${os.platform()}|${os.release()}`),
    h('mem', String(Math.round(os.totalmem() / 2 ** 30 / 2) * 2)),
    h('net', `${nets[0] ?? ''}|${os.hostname()}`),
  ];
}

/** installationId پایدار وقتی دیسک قابل‌نوشتن نیست (از خود اثرانگشت مشتق می‌شود). */
export function derivedInstallationId(components: string[]): string {
  return `d-${createHash('sha256').update(components.join('|')).digest('hex').slice(0, 24)}`;
}
