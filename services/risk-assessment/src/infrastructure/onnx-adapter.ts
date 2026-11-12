import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-node';
import { workspacePath } from '@vsafe/platform';
import { InferencePort } from '../application/risk-service';
export class OnnxInference implements InferencePort {
  private session?: ort.InferenceSession;
  private meta = { version: 'unavailable', validated: false, synthetic: false };
  async load() {
    try {
      const bytes = await readFile(
        workspacePath(process.env.MODEL_PATH || 'packages/models/risk-demo.onnx'),
      );
      const m = JSON.parse(
        await readFile(
          workspacePath(process.env.MODEL_METADATA_PATH || 'packages/models/risk-demo.json'),
          'utf8',
        ),
      );
      if (
        createHash('sha256').update(bytes).digest('hex') !== m.sha256 ||
        m.featureSchema !== 'vsafe-risk-v1'
      )
        throw new Error('MODEL_CHECKSUM_OR_SCHEMA');
      this.session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['cpu'],
        intraOpNumThreads: 1,
      });
      this.meta = {
        version: m.version,
        validated: m.validated === true,
        synthetic: m.trainingData === 'synthetic',
      };
    } catch {
      console.warn('ONNX unavailable: risk results will be UNKNOWN');
    }
  }
  metadata() {
    return this.meta;
  }
  async predict(features: number[]) {
    if (!this.session) throw new Error('MODEL_UNAVAILABLE');
    const out = await this.session.run({
      features: new ort.Tensor('float32', Float32Array.from(features), [1, 5]),
    });
    return Number(out.score.data[0]);
  }
}
