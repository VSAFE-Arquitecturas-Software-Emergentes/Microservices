import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './lib.mjs';
const require = createRequire(import.meta.url);
const { onnx } = require('onnx-proto');
let state = 728;
const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const rows = Array.from({ length: 3000 }, () => {
  const x = Array.from({ length: 5 }, random);
  x[3] = x[3] > 0.5 ? 1 : 0;
  const probability = sigmoid(-3 + 4 * x[0] + 1.6 * x[1] + 1.1 * x[2] + 0.7 * x[3] - 0.3 * x[4]);
  return { x, y: random() < probability ? 1 : 0 };
});
const weights = [0, 0, 0, 0, 0];
let bias = 0;
const train = rows.slice(0, 2400),
  test = rows.slice(2400);
for (let epoch = 0; epoch < 350; epoch++) {
  const gradient = [0, 0, 0, 0, 0];
  let db = 0;
  for (const { x, y } of train) {
    const error = sigmoid(bias + x.reduce((s, v, i) => s + v * weights[i], 0)) - y;
    db += error;
    for (let i = 0; i < 5; i++) gradient[i] += error * x[i];
  }
  bias -= (0.7 * db) / train.length;
  for (let i = 0; i < 5; i++) weights[i] -= (0.7 * gradient[i]) / train.length;
}
const accuracy =
  test.filter(
    ({ x, y }) =>
      (sigmoid(bias + x.reduce((s, v, i) => s + v * weights[i], 0)) >= 0.5 ? 1 : 0) === y,
  ).length / test.length;
const tensor = (name, dims, data) => ({ name, dims, dataType: 1, floatData: data });
const value = (name, dim) => ({
  name,
  type: { tensorType: { elemType: 1, shape: { dim: [{ dimParam: 'batch' }, { dimValue: dim }] } } },
});
const model = {
  irVersion: 8,
  opsetImport: [{ domain: '', version: 13 }],
  producerName: 'VSafe academic synthetic trainer',
  graph: {
    name: 'risk-logistic-demo',
    input: [value('features', 5)],
    output: [value('score', 1)],
    initializer: [tensor('weights', [5, 1], weights), tensor('bias', [1], [bias])],
    node: [
      { opType: 'MatMul', input: ['features', 'weights'], output: ['linear'] },
      { opType: 'Add', input: ['linear', 'bias'], output: ['logit'] },
      { opType: 'Sigmoid', input: ['logit'], output: ['score'] },
    ],
  },
};
const error = onnx.ModelProto.verify(model);
if (error) throw new Error(error);
const bytes = onnx.ModelProto.encode(onnx.ModelProto.create(model)).finish();
const dir = path.join(root, 'packages', 'models');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'risk-demo.onnx'), bytes);
await writeFile(
  path.join(dir, 'risk-demo.json'),
  JSON.stringify(
    {
      version: 'synthetic-logistic-v1',
      featureSchema: 'vsafe-risk-v1',
      features: ['density', 'severeRatio', 'recentRatio', 'night', 'coverage'],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      trainingData: 'synthetic',
      validated: true,
      validationScope: 'demonstration-only',
      seed: 728,
      trainRows: train.length,
      testRows: test.length,
      testAccuracy: accuracy,
      thresholds: [0.35, 0.65],
      limitations: 'No real-world safety validity. Production mode must abstain.',
    },
    null,
    2,
  ),
);
console.log(
  `Modelo ONNX sintético: ${bytes.length} bytes; exactitud en datos sintéticos ${(accuracy * 100).toFixed(1)}%.`,
);
