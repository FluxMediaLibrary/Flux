import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';

interface AndroidReleaseManifest {
  versionCode: number;
  versionName: string;
  minimumSupportedVersionCode: number;
  mandatory: boolean;
  releaseDate: string;
  releaseNotes: string[];
  apkUrl: string;
  sha256: string;
  fileSize: number;
}

function readManifest(): AndroidReleaseManifest {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(config.ANDROID_RELEASE_ROOT, 'latest.json'), 'utf8')) as AndroidReleaseManifest;
    if (!Number.isInteger(value.versionCode) || value.versionCode < 1 || !/^\d+\.\d+\.\d+/.test(value.versionName) ||
      !Array.isArray(value.releaseNotes) || !/^[a-f0-9]{64}$/i.test(value.sha256) || !Number.isSafeInteger(value.fileSize) || value.fileSize < 1 ||
      !/^\/api\/app\/android\/download\/[A-Za-z0-9._-]+$/.test(value.apkUrl)) {
      throw new Error('invalid Android release manifest');
    }
    return value;
  } catch (error) {
    throw ApiError.notFound('No valid Android release is published', 'ANDROID_RELEASE_UNAVAILABLE');
  }
}

export const appRoutes: FastifyPluginAsync = async (app) => {
  app.get('/android/latest', async () => readManifest());
  app.get('/android/download/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!/^[A-Za-z0-9._-]+\.apk$/.test(file)) throw ApiError.notFound('APK not found');
    const absolute = path.resolve(config.ANDROID_RELEASE_ROOT, file);
    const root = path.resolve(config.ANDROID_RELEASE_ROOT) + path.sep;
    if (!absolute.startsWith(root) || !fs.existsSync(absolute)) throw ApiError.notFound('APK not found');
    return reply.header('Content-Type', 'application/vnd.android.package-archive')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .header('Content-Length', String(fs.statSync(absolute).size))
      .header('Cache-Control', 'public, max-age=300')
      .send(fs.createReadStream(absolute));
  });
};
