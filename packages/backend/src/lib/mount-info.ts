export interface DiscoveredMount {
  mountPath: string;
  filesystem: string;
  source: string;
  writableByMount: boolean;
}

function decodeMountField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
}

export function parseLinuxMountInfo(input: string): DiscoveredMount[] {
  const mounts: DiscoveredMount[] = [];
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.trim().split(' ');
    const separator = fields.indexOf('-');
    const mountField = fields[4];
    const options = fields[5];
    const filesystem = separator >= 0 ? fields[separator + 1] : undefined;
    const source = separator >= 0 ? fields[separator + 2] : undefined;
    if (!mountField || !options || !filesystem || !source) continue;
    mounts.push({
      mountPath: decodeMountField(mountField),
      filesystem,
      source: decodeMountField(source),
      writableByMount: options.split(',').includes('rw'),
    });
  }
  return mounts;
}
