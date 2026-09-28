/**
 * Pure-TypeScript inference engine for the exported Safflower RF model -- same approach as
 * Sunflower's own rfInference.ts (no Python, no ONNX, no new runtime dependency). The real model
 * (300 trees, max_depth=6) was exported to plain JSON (training/safflower/export_rf_to_json.py)
 * and VERIFIED to reproduce the real scikit-learn model's predict_proba exactly (max diff
 * 2.22e-16, i.e. floating-point epsilon) over every real training row before being copied here.
 *
 * MODEL_PATH and config.ts's SAFFLOWER_RF_MODEL_VERSION are updated together when a new model is
 * promoted -- the previous model file is always left in place on disk (never deleted).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED_FEATURE_ORDER } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODEL_PATH = join(__dirname, 'model/safflower_rf_v0.json')

interface TreeNode {
  leaf: boolean
  prob1?: number
  feature?: number
  threshold?: number
  left?: TreeNode
  right?: TreeNode
}

interface ModelExport {
  model_version: string
  features: string[]
  n_trees: number
  trees: TreeNode[]
}

let cachedModel: ModelExport | null = null

/** Loads and validates the model once per process (not per request). Throws loudly at first use
 *  if the artifact is missing or its feature order doesn't match config.ts's
 *  EXPECTED_FEATURE_ORDER, rather than silently mispredicting with misaligned features. */
function getModel(): ModelExport {
  if (cachedModel) return cachedModel
  const raw = readFileSync(MODEL_PATH, 'utf-8')
  const model = JSON.parse(raw) as ModelExport
  if (model.features.length !== EXPECTED_FEATURE_ORDER.length || model.features.some((f, i) => f !== EXPECTED_FEATURE_ORDER[i])) {
    throw new Error(`Safflower RF model feature order mismatch: model expects [${model.features.join(', ')}], config declares [${EXPECTED_FEATURE_ORDER.join(', ')}]`)
  }
  cachedModel = model
  return model
}

function walkTree(node: TreeNode, x: number[]): number {
  let n = node
  while (!n.leaf) {
    const goLeft = x[n.feature!] <= n.threshold!
    n = goLeft ? n.left! : n.right!
  }
  return n.prob1!
}

/** Runs the real, verified RF ensemble on an already-ordered feature vector (must match
 *  EXPECTED_FEATURE_ORDER exactly -- see featureExtraction.ts). Returns the class-1
 *  ("safflower weak positive") probability, averaged across all 300 trees. */
export function predictSafflowerProbability(orderedFeatures: number[]): number {
  const model = getModel()
  if (orderedFeatures.length !== model.features.length) {
    throw new Error(`Expected ${model.features.length} features, got ${orderedFeatures.length}`)
  }
  let sum = 0
  for (const tree of model.trees) sum += walkTree(tree, orderedFeatures)
  return sum / model.trees.length
}

export function getSafflowerRfModelVersion(): string {
  return getModel().model_version
}
