import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLinuxMountInfo } from '../../lib/mount-info.js';

test('parseLinuxMountInfo decodes paths and mount flags', () => {
  const mounts = parseLinuxMountInfo([
    '36 25 8:1 / /storage/My\\040Drive rw,relatime shared:1 - ext4 /dev/sda1 rw',
    '37 25 8:2 / /mnt/archive ro,relatime - xfs /dev/sdb1 ro',
  ].join('\n'));
  assert.deepEqual(mounts, [
    { mountPath: '/storage/My Drive', filesystem: 'ext4', source: '/dev/sda1', writableByMount: true },
    { mountPath: '/mnt/archive', filesystem: 'xfs', source: '/dev/sdb1', writableByMount: false },
  ]);
});
